from __future__ import annotations

import json
import sys
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parents[1]
CALIBRATION = ROOT / "calibration" / "face-towel-web-templates"
PACKAGE = CALIBRATION / "package"
VALIDATION = CALIBRATION / "validation"
sys.path.insert(0, str(ROOT))

import renderer  # noqa: E402


SCENES = [
    ("face-towel-01-wood-rack", "01-wood-rack-test.png"),
    ("face-towel-02-tabletop", "02-tabletop-test.png"),
    ("face-towel-03-wall-rail", "03-wall-rail-test.png"),
    ("face-towel-04-size-features", "04-size-features-test.png"),
]


def masked_mae(rendered: Image.Image, expected: Image.Image, mask: Image.Image) -> float:
    actual = np.asarray(rendered.convert("RGB"), dtype=np.float32)
    target = np.asarray(expected.convert("RGB"), dtype=np.float32)
    selected = np.asarray(mask.convert("L")) > 32
    return float(np.abs(actual - target)[selected].mean())


def main() -> None:
    renderer.TEMPLATES_DIR = PACKAGE / "templates"
    VALIDATION.mkdir(parents=True, exist_ok=True)
    artwork = (CALIBRATION / "test-artwork.png").read_bytes()
    card_artwork = (CALIBRATION / "card-artwork.png").read_bytes()
    results: list[dict[str, object]] = []
    previews: list[tuple[str, Image.Image]] = []

    for template_id, expected_name in SCENES:
        rendered = renderer.render_preview(template_id, BytesIO(artwork))
        expected = Image.open(CALIBRATION / expected_name).convert("RGB")
        mask = Image.open(PACKAGE / "templates" / template_id / "print_mask.png")
        output = VALIDATION / f"{template_id}.webp"
        rendered.save(output, format="WEBP", quality=94, method=6)
        results.append(
            {
                "template_id": template_id,
                "size": list(rendered.size),
                "masked_mae": round(masked_mae(rendered, expected, mask), 3),
                "output": str(output),
            }
        )
        previews.append((template_id, rendered.copy()))

    card = renderer.render_preview(SCENES[0][0], BytesIO(card_artwork))
    card.save(PACKAGE / "card.webp", format="WEBP", quality=94, method=6)

    thumb_size = (720, 720)
    contact = Image.new("RGB", (1440, 1500), "white")
    draw = ImageDraw.Draw(contact)
    for index, (label, preview) in enumerate(previews):
        x = (index % 2) * 720
        y = (index // 2) * 750
        contact.paste(ImageOps.fit(preview.convert("RGB"), thumb_size), (x, y))
        draw.rectangle((x, y + 710, x + 720, y + 750), fill="white")
        draw.text((x + 12, y + 718), label, fill="black")
    contact.save(VALIDATION / "face-towel-contact-sheet.jpg", quality=92)
    report = {"templates": results, "card": str(PACKAGE / "card.webp")}
    (VALIDATION / "report.json").write_text(
        json.dumps(report, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
