from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
CALIBRATION_ROOT = ROOT / "calibration" / "square-pillow-web-templates"
TEMPLATES_ROOT = ROOT / "templates"


@dataclass(frozen=True)
class Scene:
    calibration_id: str
    template_id: str
    name: str
    points: list[list[int]]


SCENES = [
    Scene(
        calibration_id="03-grey-sofa-closeup",
        template_id="pillow-psd-03-grey-sofa",
        name="Grey sofa close-up",
        points=[[150, 152], [1127, 152], [1127, 1071], [150, 1071]],
    ),
    Scene(
        calibration_id="04-size-18in-45cm",
        template_id="pillow-psd-04-size",
        name="18in / 45cm size view",
        points=[[129, 179], [1130, 179], [1130, 1135], [129, 1135]],
    ),
    Scene(
        calibration_id="06-wood-chair",
        template_id="pillow-psd-06-wood-chair",
        name="Wood chair scene",
        points=[[279, 296], [958, 296], [958, 927], [279, 927]],
    ),
]


def main() -> None:
    built: list[dict[str, object]] = []

    for scene in SCENES:
        white = Image.open(
            CALIBRATION_ROOT / f"{scene.calibration_id}-white.png"
        ).convert("RGB")
        black = Image.open(
            CALIBRATION_ROOT / f"{scene.calibration_id}-black.png"
        ).convert("RGB")

        if white.size != black.size:
            raise ValueError(f"Response size mismatch for {scene.template_id}")

        diff = ImageChops.difference(white, black).convert("L")
        diff = ImageOps.autocontrast(diff)
        mask = diff.point(lambda value: 255 if value > 18 else 0)
        mask = mask.filter(ImageFilter.GaussianBlur(1.15))

        template_root = TEMPLATES_ROOT / scene.template_id
        template_root.mkdir(parents=True, exist_ok=True)
        white.save(template_root / "base.webp", format="WEBP", quality=94, method=6)
        mask.save(template_root / "print_mask.png")

        geometry = {
            "template_id": scene.template_id,
            "name": scene.name,
            "render_mode": "psd_multiply",
            "output_width": white.width,
            "output_height": white.height,
            "print_area": {
                "type": "quad",
                "points": scene.points,
            },
            "blend": {
                "mask_opacity": 1.0,
            },
        }
        (template_root / "geometry.json").write_text(
            json.dumps(geometry, indent=2),
            encoding="utf-8",
        )
        built.append(geometry)

    print(json.dumps(built, indent=2))


if __name__ == "__main__":
    main()
