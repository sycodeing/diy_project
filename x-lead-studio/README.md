# X Lead Studio

Local acquisition workbench. It binds to `127.0.0.1:8020`, keeps discovery data in `.data/`, and can execute individually approved, scheduled X posts or replies through a separate local x-use data directory. It never uploads X cookies to the website or Supabase.

## Setup

```powershell
cd D:\Coding\DiyProject\x-lead-studio
..\mockup-renderer\.venv\Scripts\python.exe -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
Copy-Item .env.example .env
```

Load `.env` in your preferred secret manager or PowerShell session, then run `./run.ps1`. Open `http://127.0.0.1:8020`. The marketing secret must match the DIY site's `MARKETING_INGEST_SECRET`.

The optional `install-startup-task.ps1` registers a hidden Windows logon task. Run it only after the workbench is configured and tested.

## Reviewed x-use automatic posts and replies

Install and initialize the pinned x-use release:

```powershell
cd D:\Coding\DiyProject\x-lead-studio
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python -m patchright install chromium
$env:X_USE_HOME = "$env:LOCALAPPDATA\x-use"
.\.venv\Scripts\x-use init
.\.venv\Scripts\x-use doctor
```

Import only accounts you operate. Each x-use `account_id` must match the account key entered at `/admin/x-auto-posts`. Give each account a distinct positioning, audience, topic set and voice. This is content separation, not proxy or IP rotation.

Set the same dedicated `X_REPLY_WORKER_SECRET` on the website and in this worker's `.env`, then run `./run.ps1`. The workflow is:

1. An administrator creates the exact post or reply draft and selects one account.
2. The administrator approves that individual draft.
3. At the planned time, the local worker asks x-use to create its own pending draft (`post_tweet` or `reply_to_tweet`), verifies the draft ID, and calls `approve_draft` for that same text.
4. `/admin/x-manual-posts` is a separate manual-only queue. It never reaches this worker and only records operator-confirmed results.
5. The website records `sent`, `failed`, or `uncertain`. Claimed or uncertain writes are never automatically retried.

No server-side LLM key is required because the approved text is passed explicitly.

## First-phase audience

Automatic collection runs two US pet-owner experiments: `new_adoption` and `pet_birthday`. Each daily run splits the configured limit across both segments and uses two searches per segment:

1. A location-first query with `place_country:US`.
2. A broader English query whose results are checked against the Post place and public profile location.

When Apify is configured, the worker performs a second, profile-only lookup for authors of viable cat/dog posts and does not fetch their timelines. It combines public profile `location` and X's `accountBasedIn` signal with the post query evidence: confirmed US accounts continue, explicit non-US accounts are rejected, and unresolved or conflicting locations remain in `location_review`.

The default daily limit is 40 candidates across both segments. Change it with `AUTO_COLLECTION_DAILY_LIMIT`. A candidate needs a US-confidence score of at least 70 by default. Candidates without enough public location evidence remain in `location_review`; pet businesses, shelters, ads, and adoption listings are put in `rejected_targeting`.

The hosted admin queues use one shared discovery worker. Set the same `X_LEAD_WORKER_SECRET` on the website and in this worker's `.env`. Jobs created at `/admin/x-lead-search` are claimed locally, searched with the locally encrypted discovery cookie, and written into the single `/admin/x-leads` candidate pool. Both manual and automatic sending select from that pool; neither sending mode runs its own search.

For Apify discovery, set `APIFY_API_TOKEN` in the local `.env`. The worker then runs the configured X Search Scraper Actor, stores the raw Dataset JSON under `.data/apify/runs/<run-id>.json`, normalizes one preview image per post (a photo or video thumbnail), and upserts the reviewed candidate metadata into the shared Supabase `x_leads` pool. The token and raw cache stay local. Without an Apify token, the worker falls back to the locally encrypted X cookie reader.

Collection calculates engagement, account quality, recency, occasion, ownership, and US evidence from the source Post. Image analysis then decides whether the pet photo is suitable for a pillow. A lead reaches `review` only after passing both targeting and image checks. Manual review can correct occasion, ownership, and US evidence.

The dashboard records the audience segment on each lead and uses it in the default marketing campaign name, so `new_adoption` and `pet_birthday` can be compared through the existing payment attribution funnel.

## Safety boundary

- Only operator-owned accounts with locally imported cookies. Cookies stay under `X_USE_HOME`.
- Discovery remains read-only. Public replies require exact-text, per-item administrator approval.
- No DMs, automatic reply generation, batch cycles, queue auto-drain, proxy/IP rotation, fingerprint spoofing, CAPTCHA handling, or challenge bypass.
- Account selection is explicit; the system never rotates accounts automatically.
- CAPTCHA, Cloudflare, authentication failure, or persistent throttling pauses collection.
- Original images and mockups are removed after seven days. Anonymous statistics and suppression records remain.
- Routine tests mock X and do not authenticate to X.
