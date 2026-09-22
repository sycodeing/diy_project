from __future__ import annotations

import sys
from io import BytesIO
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import UnidentifiedImageError

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "mockup-renderer"))

from renderer import TemplateNotFoundError, render_preview  # noqa: E402

MAX_ARTWORK_BYTES = 10 * 1024 * 1024

app = FastAPI(title="DIY Mockup Renderer")


@app.get("/")
@app.get("/api/mockup")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/")
@app.post("/api/mockup")
async def render_mockup(
    template_id: str = Form("pillow-psd-01"),
    artwork: UploadFile = File(...),
) -> Response:
    if not artwork.content_type or not artwork.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="artwork must be an image")

    payload = await artwork.read(MAX_ARTWORK_BYTES + 1)
    if len(payload) > MAX_ARTWORK_BYTES:
        raise HTTPException(status_code=413, detail="artwork exceeds 10 MB")

    try:
        rendered = render_preview(template_id, BytesIO(payload))
    except TemplateNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (UnidentifiedImageError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="artwork could not be rendered") from exc

    output = BytesIO()
    rendered.save(output, format="WEBP", quality=88, method=6)
    return Response(
        content=output.getvalue(),
        headers={"Cache-Control": "private, no-store"},
        media_type="image/webp",
    )
