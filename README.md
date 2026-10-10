# theBestDiy

A Vercel-ready custom pillow preview and ordering MVP built with Next.js,
Supabase, and a lightweight Python mockup renderer.

The first-release SKU is deliberately fixed: one set of two standard-white
polyester pillow covers, 18in / 45cm, with inserts not included.

## Current Flow

- `/` is the product showcase home page.
- `/design` accepts `image`, `shape`, and `position` query parameters.
- Legacy links that pass an image to `/` redirect to `/design` automatically.
- Users can replace the incoming artwork, drag/zoom a square crop, and compare
  four realistic pillow scenes.
- Checkout validates a configurable delivery address, stores the artwork in
  private Supabase Storage, and creates a real Stripe Checkout Session.
- A verified Stripe payment creates a Temu purchase job for the manual payment
  desk.
- `/orders` lists database-backed customer orders.
- `/admin/temu-purchases` shows the payment queue, configuration gaps, and
  attention-required jobs.
- `/admin/marketing` reports the anonymous generated-to-paid acquisition funnel.
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

Apply every SQL file in `supabase/migrations` before enabling live checkout.

Stripe Checkout classifies the pillow covers as general tangible goods. Keep
`STRIPE_AUTOMATIC_TAX_ENABLED=false` until the Stripe Tax head-office address
and every legally required tax registration are configured; Stripe Tax does
not register the business with tax authorities automatically.

## Temu manual purchase desk

Paid orders are added to `/admin/temu-purchases`. The page shows the target
product/specification and a delivery snapshot with per-field
and full-address copy controls. After completing payment in Temu, enter the
Temu parent order number (and optional child order number) to bind it to the
local order.

The procurement mapping is stored in `src/lib/temu-procurement.ts`, not in
environment variables. The admin opens the mapped product and manually selects
the instructed live variant and checkout price.

The first release is deliberately manual. It does not require a Temu Partner
application, API key, access token, or scheduled order synchronization. The
operator binds the Temu order numbers and advances fulfillment from the admin
desk.

Legacy anon and service-role key names remain supported.

## X lead studio and attribution

The independent local workbench lives in `x-lead-studio/`. It uses a single
self-owned X account for read-only discovery, stores its cookie with Windows
DPAPI, renders the existing four pillow mockups, and leaves all sending to a
human operator. Follow `x-lead-studio/README.md` for setup.

Set the same strong secret locally and on the deployed DIY site:

```env
MARKETING_INGEST_SECRET=...
```

The local workbench signs `POST /api/marketing/links`. The site returns an
opaque `/go/<token>` URL, applies a seven-day last-touch HttpOnly cookie, and
records design, preview, checkout, and verified Stripe payment events. Apply
`supabase/migrations/20260928010000_marketing_attribution.sql` before using the
flow. The daily retention cron removes expired source image URLs and old nonces.

## Verification

```powershell
npm run lint
npm run build
cd x-lead-studio
.\.venv\Scripts\python.exe -m pytest -q
```

The Python deployment entry point can be checked locally with:

```powershell
.\mockup-renderer\.venv\Scripts\python.exe -m uvicorn api.mockup:app --port 8011
```
