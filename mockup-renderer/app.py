from __future__ import annotations

from io import BytesIO

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from renderer import TemplateNotFoundError, list_templates, render_preview

app = FastAPI(title="DIY Mockup Renderer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/templates")
def templates() -> list[dict[str, str]]:
    return list_templates()


@app.post("/render-preview")
async def render_preview_endpoint(
    template_id: str = Form("pillow-psd-01"),
    artwork: UploadFile = File(...),
) -> Response:
    if not artwork.content_type or not artwork.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="artwork must be an image")

    try:
        rendered = render_preview(template_id, BytesIO(await artwork.read()))
    except TemplateNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    output = BytesIO()
    rendered.save(output, format="WEBP", quality=88, method=6)
    return Response(content=output.getvalue(), media_type="image/webp")
