from __future__ import annotations

import hashlib
import json
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps
from psd_tools import PSDImage


SOURCE = Path(r"D:\Temu\Psd\face_towel.psd")
OUTPUT = (
    Path(__file__).resolve().parents[2]
    / "public"
    / "design-samples"
    / "face-towel-fallback.webp"
)
SMART_OBJECT_PATH = (
    "04_SIZE_AND_FEATURES",
    "03_REPLACEABLE_CONTENT",
    "DOUBLE_CLICK_TO_EDIT",
)
OUTPUT_SIZE = (1200, 1800)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def find_layer(psd: PSDImage, path: tuple[str, ...]):
    children = psd
    layer = None
    for name in path:
        layer = next((candidate for candidate in children if candidate.name == name), None)
        if layer is None:
            raise RuntimeError(f"PSD layer path not found: {' / '.join(path)}")
        children = layer
    return layer


def main() -> None:
    source_hash_before = sha256(SOURCE)
    psd = PSDImage.open(SOURCE)
    layer = find_layer(psd, SMART_OBJECT_PATH)
    if layer.kind != "smartobject":
        raise RuntimeError("The selected PSD layer is not a smart object")

    with layer.smart_object.open() as stream:
        embedded = PSDImage.open(BytesIO(stream.read()))
    artwork = embedded.composite().convert("RGB")

    # The embedded artwork is almost 2:3. Crop a few edge pixels rather than
    # stretching it so the original PSD pattern keeps its proportions.
    fitted = ImageOps.fit(
        artwork,
        OUTPUT_SIZE,
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    fitted.save(OUTPUT, "WEBP", quality=94, method=6)

    source_hash_after = sha256(SOURCE)
    if source_hash_before != source_hash_after:
        raise RuntimeError("Source PSD changed while extracting the fallback artwork")

    print(json.dumps({
        "source": str(SOURCE),
        "source_sha256_before": source_hash_before,
        "source_sha256_after": source_hash_after,
        "smart_object_path": list(SMART_OBJECT_PATH),
        "embedded_size": list(artwork.size),
        "output": str(OUTPUT),
        "output_size": list(fitted.size),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
