# Studio Blank DIY

A Vercel-ready DIY pillow commerce MVP built with Next.js App Router,
Supabase Auth/Postgres/Storage, Stripe Checkout, and Temu order mirroring.

## Features

- Email and password account flow through Supabase Auth.
- Two-step DIY editor: pillow blank selection, then front/back custom content.
- Pillow preview with color, cover style, size, text/image, shape, and preset
  placement controls.
- Private Supabase Storage uploads under `design-assets/{user_id}/...`.
- Stripe Checkout order flow with shipping address collection.
- User order list and order detail pages with Temu mirror fields.
- Admin order list/detail pages with production and Temu status updates.
- Temu import endpoint that stores marketplace-limited order data locally.
- Supabase RLS policies for user-owned designs/orders and database-backed
  admin roles.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment placeholders:

```bash
copy .env.example .env.local
```

3. Fill in `.env.local`:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
TEMU_SYNC_SECRET=...
```

4. Run `supabase/schema.sql` in the Supabase SQL Editor.

5. Add at least one admin user after that user registers:

```sql
insert into public.admin_roles (user_id)
values ('00000000-0000-0000-0000-000000000000');
```

Replace the UUID with the user's `auth.users.id`.

6. Run the app:

```bash
npm run dev
```

## Stripe Webhook

Create a webhook endpoint pointing to:

```text
https://your-domain.com/api/stripe/webhook
```

Listen for:

```text
checkout.session.completed
```

For local testing, use Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Then copy the generated webhook signing secret into `STRIPE_WEBHOOK_SECRET`.

## Temu Order Mirror

Temu remains the marketplace order source. This app stores a local copy with
the DIY design proof, payment records, and whatever Temu fields are available.
The mirror supports coarse Temu statuses:

- `UN_SHIPPING`: awaiting shipment
- `CANCELED`: canceled
- `SHIPPED`: shipped
- `UNKNOWN`: payload did not map cleanly
- `NOT_SUBMITTED`: local order has no Temu order number yet

External sync jobs can POST normalized order data to:

```text
POST /api/temu/orders/import
Authorization: Bearer <TEMU_SYNC_SECRET>
```

Example payload:

```json
{
  "orders": [
    {
      "localOrderId": "00000000-0000-0000-0000-000000000000",
      "parentOrderSn": "PO-123",
      "orderSn": "O-456",
      "status": "UN_SHIPPING",
      "shipping": { "masked": true },
      "raw": { "source": "temu-partner-v2" }
    }
  ]
}
```

If `localOrderId` is omitted, the importer matches by `parentOrderSn`.

## Deployment

Deploy as a standard Next.js project on Vercel. Add all environment variables
for Production and Preview. Set `NEXT_PUBLIC_APP_URL` to the deployed origin.

Before deploying:

```bash
npm run lint
npm run build
```
