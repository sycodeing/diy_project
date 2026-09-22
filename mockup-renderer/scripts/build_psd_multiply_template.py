from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageChops, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
CALIBRATION_ROOT = ROOT / "calibration" / "square-pillow-replace-test"
TEMPLATE_ROOT = ROOT / "templates" / "pillow-psd-01"


def main() -> None:
    white = Image.open(CALIBRATION_ROOT / "response-white.png").convert("RGB")
    black = Image.open(CALIBRATION_ROOT / "response-black.png").convert("RGB")

    diff = ImageChops.difference(white, black).convert("L")
    diff = ImageOps.autocontrast(diff)
    mask = diff.point(lambda value: 255 if value > 18 else 0)
    mask = mask.filter(ImageFilter.GaussianBlur(1.15))

    points = [
        [114, 177],
        [603, 177],
        [603, 640],
        [114, 640],
    ]
    TEMPLATE_ROOT.mkdir(parents=True, exist_ok=True)
    white.save(TEMPLATE_ROOT / "base.webp", format="WEBP", quality=94, method=6)
    mask.save(TEMPLATE_ROOT / "print_mask.png")

    geometry = {
        "template_id": "pillow-psd-01",
        "name": "PSD calibrated square pillow",
        "render_mode": "psd_multiply",
        "output_width": white.width,
        "output_height": white.height,
        "print_area": {
            "type": "quad",
            "points": points,
        },
        "blend": {
            "mask_opacity": 1.0,
        },
    }
    (TEMPLATE_ROOT / "geometry.json").write_text(
        json.dumps(geometry, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(geometry, indent=2))


def find_quad_points(mask: Image.Image) -> list[list[int]]:
    array = np.array(mask)
    _, threshold = cv2.threshold(array, 24, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(threshold, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise ValueError("No printable mask contour found.")

    contour = max(contours, key=cv2.contourArea)
    rect = cv2.minAreaRect(contour)
    box = cv2.boxPoints(rect)
    ordered = order_points(box)
    return [[int(round(x)), int(round(y))] for x, y in ordered]


def order_points(points: np.ndarray) -> np.ndarray:
    points = np.array(points, dtype="float32")
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1).reshape(-1)
    ordered = np.zeros((4, 2), dtype="float32")
    ordered[0] = points[np.argmin(sums)]
    ordered[2] = points[np.argmax(sums)]
    ordered[1] = points[np.argmin(diffs)]
    ordered[3] = points[np.argmax(diffs)]
    return ordered


if __name__ == "__main__":
    main()
