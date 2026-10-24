from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1] / "calibration" / "face-towel-web-templates"
ARTWORK_SIZE = (1200, 1800)


@dataclass(frozen=True)
class SceneLayout:
    scene_id: str
    mode: str
    content_size: tuple[int, int]


SCENES = [
    SceneLayout("01-wood-rack", "pair", (1187, 714)),
    SceneLayout("02-tabletop", "single_rotated", (1051, 1189)),
    SceneLayout("03-wall-rail", "pair", (327, 258)),
    SceneLayout("04-size-features", "full", (780, 1199)),
]


def fit_cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return ImageOps.fit(image, size, method=Image.Resampling.LANCZOS)


def middle_half(image: Image.Image, upper: bool) -> Image.Image:
    left = image.width // 4
    right = image.width * 3 // 4
    top = 0 if upper else image.height // 2
    bottom = image.height // 2 if upper else image.height
    return image.crop((left, top, right, bottom))


def prepare_content(artwork: Image.Image, layout: SceneLayout) -> Image.Image:
    artwork = artwork.convert("RGBA")
    width, height = layout.content_size
    if layout.mode == "pair":
        split = width // 2
        upper = ImageOps.flip(middle_half(artwork, upper=True))
        lower = middle_half(artwork, upper=False)
        canvas = Image.new("RGBA", layout.content_size, (0, 0, 0, 0))
        canvas.alpha_composite(fit_cover(upper, (split, height)), (0, 0))
        canvas.alpha_composite(fit_cover(lower, (width - split, height)), (split, 0))
        return canvas
    if layout.mode == "single_rotated":
        upper = ImageOps.flip(middle_half(artwork, upper=True))
        surface = fit_cover(upper, (623, 1010))
        rotated = surface.rotate(30.4, resample=Image.Resampling.BICUBIC, expand=True)
        canvas = Image.new("RGBA", layout.content_size, (0, 0, 0, 0))
        canvas.alpha_composite(
            rotated,
            ((width - rotated.width) // 2, (height - rotated.height) // 2),
        )
        return canvas
    return fit_cover(artwork, layout.content_size)


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    path = Path(r"C:\Windows\Fonts\arialbd.ttf")
    return ImageFont.truetype(str(path), size) if path.is_file() else ImageFont.load_default()


def create_direction_test() -> Image.Image:
    image = Image.new("RGB", ARTWORK_SIZE, "#f5f0e8")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 600, 900), fill="#16324f")
    draw.rectangle((600, 0, 1200, 900), fill="#e07a5f")
    draw.rectangle((0, 900, 600, 1800), fill="#81b29a")
    draw.rectangle((600, 900, 1200, 1800), fill="#f2cc8f")
    draw.text((80, 80), "TOP", fill="white", font=font(150))
    draw.text((80, 1510), "BOTTOM", fill="#16324f", font=font(115))
    draw.polygon([(930, 120), (1110, 360), (750, 360)], fill="#ffffff")
    draw.ellipse((780, 1250, 1110, 1580), fill="#3d405b")
    return image


def create_card_artwork() -> Image.Image:
    image = Image.new("RGB", ARTWORK_SIZE, "#f4ede2")
    draw = ImageDraw.Draw(image)
    draw.ellipse((-240, -140, 760, 860), fill="#d8e6dc")
    draw.ellipse((520, 980, 1460, 1920), fill="#e7b7a5")
    draw.rounded_rectangle((235, 490, 965, 1310), radius=250, fill="#315f63")
    draw.ellipse((380, 645, 820, 1085), fill="#f4ede2")
    draw.arc((405, 705, 795, 1080), 18, 162, fill="#c76d55", width=34)
    draw.ellipse((455, 810, 515, 870), fill="#315f63")
    draw.ellipse((685, 810, 745, 870), fill="#315f63")
    return image


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    direction = create_direction_test()
    card = create_card_artwork()
    direction.save(ROOT / "test-artwork.png")
    card.save(ROOT / "card-artwork.png")
    for name, artwork in (
        ("white", Image.new("RGB", ARTWORK_SIZE, "white")),
        ("black", Image.new("RGB", ARTWORK_SIZE, "black")),
        ("test", direction),
        ("card", card),
    ):
        for layout in SCENES:
            prepare_content(artwork, layout).save(
                ROOT / f"{layout.scene_id}-{name}-content.png"
            )
    print(f"Prepared {len(SCENES)} scene layouts in {ROOT}")


if __name__ == "__main__":
    main()
