# Mockup Renderer

Local preview renderer for the DIY pillow editor.

It is intentionally separate from the Next.js app. Next.js handles the UI,
cropping, mock orders, and calls this service only to generate a realistic
preview image. Factory output still uses the original/cropped artwork, not the
mockup preview.

## Run Locally

```powershell
cd D:\Coding\DiyProject\mockup-renderer
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8010
```

Then set the Next.js environment variable:

```env
NEXT_PUBLIC_MOCKUP_RENDERER_URL=http://127.0.0.1:8010
```

## API

`GET /health`

`GET /templates`

`POST /render-preview`

Multipart fields:

- `template_id`: defaults to `pillow-psd-01`
- `artwork`: image file to place into the product scene

The response is a WebP image.

The pillow editor currently renders these templates for every uploaded image:

- `pillow-psd-01`
- `pillow-psd-03-grey-sofa`
- `pillow-psd-04-size`
- `pillow-psd-06-wood-chair`
