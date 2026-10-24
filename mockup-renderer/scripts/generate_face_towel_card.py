from __future__ import annotations

import hashlib
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
SOURCE_PSD = Path(r"D:\Temu\Psd\face_towel.psd")
ARTWORK = REPO / "public" / "design-samples" / "face-towel-fallback.webp"
OUTPUT = REPO / "public" / "showcase" / "face-towel-card.webp"
TEMPLATES = (
    ("face-towel-01-wood-rack", "face-towel-01-wood-rack-fallback.webp"),
    ("face-towel-02-tabletop", "face-towel-02-tabletop-fallback.webp"),
    ("face-towel-03-wall-rail", "face-towel-03-wall-rail-fallback.webp"),
    ("face-towel-04-size-features", "face-towel-04-size-features-fallback.webp"),
)
sys.path.insert(0, str(ROOT))

import renderer  # noqa: E402


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    source_hash_before = sha256(SOURCE_PSD)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    artwork_bytes = ARTWORK.read_bytes()

    for template_id, filename in TEMPLATES:
        rendered = renderer.render_preview(template_id, BytesIO(artwork_bytes))
        if rendered.size != (1500, 1500):
            raise RuntimeError(f"Unexpected {template_id} output size: {rendered.size}")
        rendered.convert("RGB").save(
            OUTPUT.parent / filename,
            "WEBP",
            quality=94,
            method=6,
        )

    scene_one = Image.open(OUTPUT.parent / TEMPLATES[0][1]).convert("RGB")
    scene_one.save(OUTPUT, "WEBP", quality=94, method=6)
    with Image.open(OUTPUT) as card:
        if card.format != "WEBP" or card.size != (1500, 1500):
            raise RuntimeError("Generated card is not a square 1500px WebP")

    source_hash_after = sha256(SOURCE_PSD)
    if source_hash_before != source_hash_after:
        raise RuntimeError("Source PSD changed while generating the product card")

    print(f"templates={','.join(template_id for template_id, _ in TEMPLATES)}")
    print(f"artwork={ARTWORK}")
    print(f"output={OUTPUT}")
    print(f"source_sha256={source_hash_after}")


if __name__ == "__main__":
    main()
