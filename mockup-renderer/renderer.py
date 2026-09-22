from __future__ import annotations

import json
from dataclasses import dataclass
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


def render_preview(template_id: str, artwork_file: BytesIO) -> Image.Image:
    template = load_template(template_id)
    artwork = Image.open(artwork_file).convert("RGBA")
    warped = warp_artwork(artwork, template)
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


def warp_artwork(artwork: Image.Image, template: MockupTemplate) -> Image.Image:
    prepared = fit_cover(artwork, template.output_size).convert("RGBA")

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


def fit_cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return ImageOps.fit(image, size, method=Image.Resampling.LANCZOS)


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
