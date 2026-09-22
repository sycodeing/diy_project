from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: build_pillow_template.py <reference-image> <template-dir>")
        return 2

    source_path = Path(sys.argv[1])
    template_dir = Path(sys.argv[2])
    geometry_path = template_dir / "geometry.json"

    template_dir.mkdir(parents=True, exist_ok=True)

    with geometry_path.open("r", encoding="utf-8") as handle:
        geometry = json.load(handle)

    output_size = (geometry["output_width"], geometry["output_height"])
    points = [tuple(point) for point in geometry["print_area"]["points"]]
    base = ImageOps.fit(Image.open(source_path).convert("RGB"), output_size)
    base.save(template_dir / "base.webp", format="WEBP", quality=92)

    mask = Image.new("L", output_size, 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    edge_blur = float(geometry.get("blend", {}).get("edge_blur", 1.2))
    mask = mask.filter(ImageFilter.GaussianBlur(edge_blur))
    mask.save(template_dir / "print_mask.png")

    luminance = ImageOps.grayscale(base).filter(ImageFilter.GaussianBlur(3))
    dark = luminance.point(lambda value: max(0, 132 - value) * 2)
    light = luminance.point(lambda value: max(0, value - 156) * 2)

    shadow = Image.new("RGBA", output_size, (55, 48, 40, 0))
    shadow.putalpha(
        ImageChops.multiply(dark, mask).filter(ImageFilter.GaussianBlur(1))
    )
    shadow.save(template_dir / "shadow.png")

    highlight = Image.new("RGBA", output_size, (255, 255, 248, 0))
    highlight.putalpha(
        ImageChops.multiply(light, mask).filter(ImageFilter.GaussianBlur(1))
    )
    highlight.save(template_dir / "highlight.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
