from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageChops, ImageOps

try:
    import cv2
except ImportError:  # pragma: no cover - local fallback when OpenCV is absent
    cv2 = None

ROOT = Path(__file__).resolve().parent
TEMPLATES_DIR = ROOT / "templates"


class TemplateNotFoundError(FileNotFoundError):
    pass


@dataclass(frozen=True)
class MockupTemplate:
    artwork_layout: dict[str, Any] | None
    base: Image.Image
    blend: dict[str, float]
    highlight: Image.Image | None
    mask: Image.Image
    name: str
    output_size: tuple[int, int]
    points: list[tuple[float, float]]
    render_mode: str
    shadow: Image.Image | None
    template_id: str


def list_templates() -> list[dict[str, str]]:
    templates: list[dict[str, str]] = []

    for geometry_path in sorted(TEMPLATES_DIR.glob("*/geometry.json")):
        with geometry_path.open("r", encoding="utf-8") as handle:
            geometry = json.load(handle)
        templates.append(
            {
                "id": geometry["template_id"],
                "name": geometry.get("name", geometry["template_id"]),
            }
        )

    return templates


def render_preview(
    template_id: str,
    artwork_file: BytesIO,
    focus_mode: str | None = None,
) -> Image.Image:
    template = load_template(template_id)
    artwork = Image.open(artwork_file).convert("RGBA")
    warped = warp_artwork(artwork, template, focus_mode)
    base = template.base.copy()
    mask = template.mask

    if template.render_mode == "psd_multiply":
        return apply_psd_multiply(
            base,
            warped,
            mask,
            template.blend.get("mask_opacity", 1.0),
        )

    if template.shadow is None or template.highlight is None:
        raise ValueError(f"Template is missing shadow/highlight assets: {template_id}")

    composed = Image.composite(warped, base, mask)
    composed = apply_multiply_shadow(
        composed,
        template.shadow,
        template.blend.get("shadow_opacity", 0.32),
    )
    composed = apply_screen_highlight(
        composed,
        template.highlight,
        template.blend.get("highlight_opacity", 0.24),
    )
    return composed.convert("RGB")


def load_template(template_id: str) -> MockupTemplate:
    template_dir = TEMPLATES_DIR / template_id
    geometry_path = template_dir / "geometry.json"

    if not geometry_path.exists():
        raise TemplateNotFoundError(f"Template not found: {template_id}")

    with geometry_path.open("r", encoding="utf-8") as handle:
        geometry: dict[str, Any] = json.load(handle)

    output_size = (
        int(geometry["output_width"]),
        int(geometry["output_height"]),
    )
    points = [tuple(point) for point in geometry["print_area"]["points"]]
    render_mode = geometry.get("render_mode", "overlay")

    return MockupTemplate(
        artwork_layout=geometry.get("artwork_layout"),
        base=Image.open(template_dir / "base.webp").convert("RGBA"),
        blend=geometry.get("blend", {}),
        highlight=load_optional_image(template_dir / "highlight.png"),
        mask=Image.open(template_dir / "print_mask.png").convert("L"),
        name=geometry.get("name", template_id),
        output_size=output_size,
        points=points,
        render_mode=render_mode,
        shadow=load_optional_image(template_dir / "shadow.png"),
        template_id=template_id,
    )


def load_optional_image(path: Path) -> Image.Image | None:
    if not path.exists():
        return None

    return Image.open(path).convert("RGBA")


def warp_artwork(
    artwork: Image.Image,
    template: MockupTemplate,
    focus_mode: str | None = None,
) -> Image.Image:
    prepared = prepare_artwork(
        artwork,
        template.artwork_layout,
        template.output_size,
        focus_mode,
    )

    if cv2 is None:
        return warp_artwork_fallback(prepared, template)

    source = np.array(prepared)
    destination = np.zeros(
        (template.output_size[1], template.output_size[0], 4),
        dtype=np.uint8,
    )
    src_points = np.float32(
        [
            [0, 0],
            [prepared.width, 0],
            [prepared.width, prepared.height],
            [0, prepared.height],
        ]
    )
    dst_points = np.float32(template.points)
    matrix = cv2.getPerspectiveTransform(src_points, dst_points)
    warped = cv2.warpPerspective(
        source,
        matrix,
        template.output_size,
        dst=destination,
        borderMode=cv2.BORDER_TRANSPARENT,
    )
    return Image.fromarray(warped).convert("RGBA")


def prepare_artwork(
    artwork: Image.Image,
    layout: dict[str, Any] | None,
    output_size: tuple[int, int],
    focus_mode: str | None = None,
) -> Image.Image:
    focus = detect_pet_head_focus(artwork) if focus_mode == "pet_head" else None
    if not layout:
        return fit_cover(artwork, output_size, focus).convert("RGBA")

    content_size = (
        int(layout["content_width"]),
        int(layout["content_height"]),
    )
    mode = str(layout.get("mode", "full"))
    source = artwork.convert("RGBA")
    if mode == "full":
        return fit_cover(source, content_size, focus).convert("RGBA")

    middle = source.crop(
        (
            source.width // 4,
            0,
            source.width * 3 // 4,
            source.height,
        )
    )
    upper = middle.crop((0, 0, middle.width, middle.height // 2))
    lower = middle.crop((0, middle.height // 2, middle.width, middle.height))

    if mode == "pair":
        split = content_size[0] // 2
        prepared = Image.new("RGBA", content_size, (0, 0, 0, 0))
        prepared.alpha_composite(
            fit_cover(ImageOps.flip(upper), (split, content_size[1])).convert("RGBA"),
            (0, 0),
        )
        prepared.alpha_composite(
            fit_cover(lower, (content_size[0] - split, content_size[1])).convert("RGBA"),
            (split, 0),
        )
        return prepared

    if mode == "single_rotated":
        surface_size = (
            int(layout["surface_width"]),
            int(layout["surface_height"]),
        )
        surface = fit_cover(ImageOps.flip(upper), surface_size).convert("RGBA")
        rotated = surface.rotate(
            float(layout.get("rotation_degrees", 0.0)),
            resample=Image.Resampling.BICUBIC,
            expand=True,
        )
        prepared = Image.new("RGBA", content_size, (0, 0, 0, 0))
        prepared.alpha_composite(
            rotated,
            (
                (content_size[0] - rotated.width) // 2,
                (content_size[1] - rotated.height) // 2,
            ),
        )
        return prepared

    raise ValueError(f"Unsupported artwork layout mode: {mode}")


def warp_artwork_fallback(
    prepared: Image.Image,
    template: MockupTemplate,
) -> Image.Image:
    xs = [point[0] for point in template.points]
    ys = [point[1] for point in template.points]
    left, top, right, bottom = map(round, (min(xs), min(ys), max(xs), max(ys)))
    layer = Image.new("RGBA", template.output_size, (0, 0, 0, 0))
    layer.alpha_composite(prepared.resize((right - left, bottom - top)), (left, top))
    return layer


def fit_cover(
    image: Image.Image,
    size: tuple[int, int],
    focus: tuple[float, float] | None = None,
) -> Image.Image:
    if focus is None:
        return ImageOps.fit(image, size, method=Image.Resampling.LANCZOS)

    target_width, target_height = size
    source_width, source_height = image.size
    target_ratio = target_width / target_height
    source_ratio = source_width / source_height
    if source_ratio > target_ratio:
        crop_height = source_height
        crop_width = crop_height * target_ratio
    else:
        crop_width = source_width
        crop_height = crop_width / target_ratio

    focus_x = min(1.0, max(0.0, focus[0])) * source_width
    focus_y = min(1.0, max(0.0, focus[1])) * source_height
    left = min(max(0.0, focus_x - crop_width / 2), source_width - crop_width)
    top = min(max(0.0, focus_y - crop_height / 2), source_height - crop_height)
    crop = image.crop((left, top, left + crop_width, top + crop_height))
    return crop.resize(size, Image.Resampling.LANCZOS)


def detect_pet_head_focus(image: Image.Image) -> tuple[float, float] | None:
    if cv2 is None or image.width < 32 or image.height < 32:
        return None

    rgb = np.asarray(image.convert("RGB"))
    scale = min(1.0, 384 / max(rgb.shape[:2]))
    if scale < 1.0:
        rgb = cv2.resize(
            rgb,
            (round(rgb.shape[1] * scale), round(rgb.shape[0] * scale)),
            interpolation=cv2.INTER_AREA,
        )
    height, width = rgb.shape[:2]
    return _detect_pet_head_focus_cached(width, height, rgb.tobytes())


@lru_cache(maxsize=32)
def _detect_pet_head_focus_cached(
    width: int,
    height: int,
    pixels: bytes,
) -> tuple[float, float] | None:
    rgb = np.frombuffer(pixels, dtype=np.uint8).reshape((height, width, 3))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

    cascade = _cat_face_cascade()
    if cascade is not None:
        faces = cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=3,
            minSize=(max(24, width // 12), max(24, height // 12)),
        )
        if len(faces):
            x, y, face_width, face_height = max(faces, key=lambda face: face[2] * face[3])
            return ((x + face_width / 2) / width, (y + face_height / 2) / height)

    return _foreground_head_focus(rgb)


@lru_cache(maxsize=1)
def _cat_face_cascade() -> Any | None:
    if cv2 is None:
        return None
    path = Path(cv2.data.haarcascades) / "haarcascade_frontalcatface_extended.xml"
    cascade = cv2.CascadeClassifier(str(path))
    return None if cascade.empty() else cascade


def _foreground_head_focus(rgb: np.ndarray) -> tuple[float, float] | None:
    height, width = rgb.shape[:2]
    margin_x = max(2, round(width * 0.04))
    margin_y = max(2, round(height * 0.04))
    if width <= margin_x * 2 or height <= margin_y * 2:
        return None

    mask = np.zeros((height, width), np.uint8)
    background = np.zeros((1, 65), np.float64)
    foreground = np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(
            cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR),
            mask,
            (margin_x, margin_y, width - margin_x * 2, height - margin_y * 2),
            background,
            foreground,
            2,
            cv2.GC_INIT_WITH_RECT,
        )
    except cv2.error:
        return None

    foreground_mask = np.where(
        (mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD),
        255,
        0,
    ).astype(np.uint8)
    kernel_size = max(3, round(min(width, height) * 0.015))
    if kernel_size % 2 == 0:
        kernel_size += 1
    kernel = np.ones((kernel_size, kernel_size), np.uint8)
    foreground_mask = cv2.morphologyEx(foreground_mask, cv2.MORPH_CLOSE, kernel)

    count, _, stats, _ = cv2.connectedComponentsWithStats(foreground_mask)
    image_area = width * height
    components = [
        stats[index]
        for index in range(1, count)
        if image_area * 0.02 <= stats[index, cv2.CC_STAT_AREA] <= image_area * 0.90
    ]
    if not components:
        return None

    def component_score(component: np.ndarray) -> float:
        x, y, box_width, box_height, area = map(float, component)
        center_x = x + box_width / 2
        center_y = y + box_height / 2
        distance = ((center_x / width - 0.5) ** 2 + (center_y / height - 0.5) ** 2) ** 0.5
        return area * max(0.65, 1.0 - distance * 0.35)

    x, y, box_width, box_height, _ = map(int, max(components, key=component_score))
    if box_width >= box_height * 1.35:
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        detail = cv2.Laplacian(gray, cv2.CV_32F)
        detail = cv2.GaussianBlur(np.abs(detail), (0, 0), sigmaX=max(2, box_height * 0.06))
        left_score = float(detail[y:y + box_height, x:x + box_width // 3].mean())
        right_score = float(detail[y:y + box_height, x + box_width * 2 // 3:x + box_width].mean())
        if max(left_score, right_score) > min(left_score, right_score) * 1.12:
            head_x = x + box_width * (0.2 if left_score > right_score else 0.8)
        else:
            head_x = x + box_width * 0.5
        head_y = y + box_height * 0.45
    else:
        head_x = x + box_width * 0.5
        head_y = y + box_height * 0.30
    return (head_x / width, head_y / height)


def apply_multiply_shadow(
    image: Image.Image,
    shadow: Image.Image,
    opacity: float,
) -> Image.Image:
    shadow_alpha = shadow.getchannel("A").point(lambda value: int(value * opacity))
    multiplied = ImageChops.multiply(image.convert("RGB"), shadow.convert("RGB"))
    return Image.composite(multiplied.convert("RGBA"), image, shadow_alpha)


def apply_screen_highlight(
    image: Image.Image,
    highlight: Image.Image,
    opacity: float,
) -> Image.Image:
    highlight_alpha = highlight.getchannel("A").point(
        lambda value: int(value * opacity)
    )
    screened = ImageChops.screen(image.convert("RGB"), highlight.convert("RGB"))
    return Image.composite(screened.convert("RGBA"), image, highlight_alpha)


def apply_psd_multiply(
    base: Image.Image,
    warped_artwork: Image.Image,
    mask: Image.Image,
    opacity: float,
) -> Image.Image:
    base_array = np.asarray(base.convert("RGB"), dtype=np.float32)
    artwork_array = np.asarray(warped_artwork.convert("RGBA"), dtype=np.float32)
    artwork_rgb = artwork_array[:, :, :3] / 255.0
    artwork_alpha = artwork_array[:, :, 3:4] / 255.0
    mask_alpha = np.asarray(mask, dtype=np.float32)[:, :, None] / 255.0
    alpha = np.clip(mask_alpha * artwork_alpha * opacity, 0.0, 1.0)

    multiplied = base_array * artwork_rgb
    output = base_array * (1.0 - alpha) + multiplied * alpha
    return Image.fromarray(np.clip(output, 0, 255).astype(np.uint8)).convert("RGB")
