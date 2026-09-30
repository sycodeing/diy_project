from __future__ import annotations

import importlib.util
import sys
from io import BytesIO
from pathlib import Path


TEMPLATES = (
    "pillow-psd-03-grey-sofa",
    "pillow-psd-04-size",
    "pillow-psd-06-wood-chair",
    "pillow-psd-01",
)


def render_four(source: Path, output_dir: Path) -> list[str]:
    renderer_path = Path(__file__).resolve().parents[2] / "mockup-renderer" / "renderer.py"
    spec = importlib.util.spec_from_file_location("diy_mockup_renderer", renderer_path)
    if not spec or not spec.loader:
        raise RuntimeError("Could not load the existing mockup renderer.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    output_dir.mkdir(parents=True, exist_ok=True)
    content = source.read_bytes()
    paths: list[str] = []
    for template in TEMPLATES:
        rendered = module.render_preview(template, BytesIO(content))
        path = output_dir / f"{template}.webp"
        if hasattr(rendered, "save"):
            rendered.save(path, format="WEBP", quality=90)
        else:
            path.write_bytes(rendered.getvalue() if hasattr(rendered, "getvalue") else rendered)
        paths.append(str(path))
    return paths
