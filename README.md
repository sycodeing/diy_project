# Studio Blank DIY

A Vercel-ready custom pillow preview and ordering MVP built with Next.js,
Supabase, and a lightweight Python mockup renderer.

## Current Flow

- `/` is the product showcase home page.
- `/design` accepts `image`, `shape`, and `position` query parameters.
- Legacy links that pass an image to `/` redirect to `/design` automatically.
- Users can replace the incoming artwork, drag/zoom a square crop, and compare
  four realistic pillow scenes.
- Checkout validates a configurable delivery area, creates a browser-local mock
  order, and redirects to its order detail page.
- `/orders` lists mock orders and, when Supabase is configured, database orders.
- `/profile` supports nickname and avatar editing.

The current preview order is:

1. Grey sofa close-up
2. 18in / 45cm size
3. Wood chair
4. Sofa room

## Vercel Architecture

- Next.js pages and route handlers deploy normally on Vercel.
- `api/mockup.py` deploys as a Vercel Python Function at `/api/mockup`.
- Production previews use the same-origin Python Function automatically.
- Local development uses the renderer at `http://127.0.0.1:8010`.
- Supabase stores application data and private design assets.

The source currently retains the Supabase Auth implementation. The intended
production account provider is Clerk from the Vercel Marketplace so the hosted
sign-in/sign-up UI, email accounts, Google login, and sessions do not need to be
maintained in this repository. Provision Clerk before replacing the current
auth adapter.

## Local Development

Install JavaScript dependencies:

```powershell
npm install
```

Create the local environment file:

```powershell
Copy-Item .env.example .env.local
```

Run the mockup renderer:

```powershell
cd mockup-renderer
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8010
```

Run Next.js from the repository root:

```powershell
npm run dev
```

Open `http://127.0.0.1:3000`.

## Service Area

Countries are configured with:

```env
NEXT_PUBLIC_ALLOWED_COUNTRIES=US,CN
```

Optional region restrictions use `COUNTRY:REGION` entries separated by `|`:

```env
NEXT_PUBLIC_ALLOWED_REGIONS=US:CA|US:NY|CN:GD
```

## Supabase

Run `supabase/schema.sql` in the Supabase SQL Editor for a new project. Existing
projects can apply migrations from `supabase/migrations`.

The app accepts the modern environment names created by the Vercel Supabase
integration:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
```

Legacy anon and service-role key names remain supported.

## Verification

```powershell
npm run lint
npm run build
```

The Python deployment entry point can be checked locally with:

```powershell
.\mockup-renderer\.venv\Scripts\python.exe -m uvicorn api.mockup:app --port 8011
```
