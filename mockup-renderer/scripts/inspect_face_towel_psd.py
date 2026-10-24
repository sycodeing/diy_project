from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path

from PIL import Image
from psd_tools import PSDImage


SOURCE = Path(r"D:\Temu\Psd\face_towel.psd")
OUTPUT = (
    Path(__file__).resolve().parents[1]
    / "calibration"
    / "face-towel-web-templates"
    / "inspection.json"
)


def main() -> None:
    psd = PSDImage.open(SOURCE)
    layers: list[dict[str, object]] = []
    smart_objects: list[dict[str, object]] = []

    def walk(children: object, parents: list[str]) -> None:
        for layer in children:  # type: ignore[union-attr]
            path = [*parents, layer.name]
            item: dict[str, object] = {
                "path": path,
                "kind": layer.kind,
                "visible": bool(layer.visible),
                "bbox": list(layer.bbox),
            }
            layers.append(item)

            if layer.kind == "smartobject":
                smart_object = dict(item)
                try:
                    with layer.smart_object.open() as stream:
                        content = stream.read()
                    try:
                        with Image.open(BytesIO(content)) as embedded:
                            smart_object["content_size"] = list(embedded.size)
                            smart_object["content_format"] = embedded.format
                    except Exception:
                        embedded_psd = PSDImage.open(BytesIO(content))
                        smart_object["content_size"] = [
                            embedded_psd.width,
                            embedded_psd.height,
                        ]
                        smart_object["content_format"] = "PSD/PSB"
                        smart_object["content_layers"] = [
                            child.name for child in embedded_psd
                        ]
                    smart_object["resolution"] = float(
                        layer.smart_object.resolution or 72.0
                    )
                except Exception as exc:  # PSDs can contain linked smart objects.
                    smart_object["content_error"] = type(exc).__name__
                smart_objects.append(smart_object)

            if layer.is_group():
                walk(layer, path)

    walk(psd, [])
    report = {
        "source": str(SOURCE),
        "document": {
            "width": psd.width,
            "height": psd.height,
            "color_mode": str(psd.color_mode),
        },
        "top_level": [layer.name for layer in psd],
        "layer_count": len(layers),
        "smart_objects": smart_objects,
        "layers": layers,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
