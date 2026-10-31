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

Import only accounts you operate. Each x-use `account_id` must match the account key entered at `/admin/x-accounts`. Give each account a distinct positioning, audience, topic set and voice, then assign one fixed authenticated proxy URL. Each approved task receives a deterministic micro-variation based on its account and task ID, so previewed text remains unchanged after approval.

Set the same dedicated `X_REPLY_WORKER_SECRET` on the website and in this worker's `.env`, then run `./run.ps1`. The workflow is:

1. An administrator creates the exact post or reply draft and selects one account.
2. The administrator approves that individual draft.
3. At the planned time, the local worker applies that account's fixed proxy, tests the real egress IP, and asks the website to reject any IP already assigned to another account.
4. Only after the route passes does x-use create its own pending draft (`post_tweet` or `reply_to_tweet`), verify the draft ID, and call `approve_draft` for that same approved text.
5. `/admin/x-manual-posts` is a separate manual-only queue. It never reaches this worker and only records operator-confirmed results.
6. The website records `sent`, `failed`, or `uncertain`. Claimed or uncertain writes are never automatically retried.

No server-side LLM key is required because the approved text is passed explicitly.

## First-phase audience

Automatic collection supports five pet-owner scenes: `new_adoption`, `pet_birthday`, `pet_adventure`, `pet_costume`, and `pet_portrait`. Each run splits the configured limit across the selected scenes.

TwitterAPI.io uses a dedicated two-stage read-only path:

1. Broad `Latest` photo searches collect recent scene-matching posts and deduplicate authors.
2. Authors without reliable Post or profile location evidence are enriched through `/twitter/user_about`; `account_based_in` is cached locally for 30 days before targeting is recalculated.

Geo-only `place_country:US` searches are disabled by default because geo-tagged posts are rare. They can be restored with `TWITTERAPI_GEO_QUERY_ENABLED=true`, with the old allocation controlled by `TWITTERAPI_US_QUERY_SHARE`. About enrichment is controlled by `TWITTERAPI_ABOUT_ENRICHMENT_ENABLED` and `TWITTERAPI_ABOUT_CACHE_DAYS`.

Every successful TwitterAPI.io response page is atomically archived under `.data/twitterapi/runs/<job-id>.json` before result-limit truncation, deduplication, photo checks, location targeting, or business/ad filtering. The archive also records the minimal About enrichment result and whether it came from cache or the API. The API key and request headers are never archived. Cached About results live in `.data/twitterapi/user-about-cache.json`.

The default daily limit is 40 candidates across both segments. Change it with `AUTO_COLLECTION_DAILY_LIMIT`. A candidate needs a US-confidence score of at least 70 by default. Candidates without enough public location evidence remain in `location_review`; pet businesses, shelters, ads, and adoption listings are put in `rejected_targeting`.

The hosted admin queues use one shared discovery worker. Set the same `X_LEAD_WORKER_SECRET` on the website and in this worker's `.env`, then set `TWITTERAPI_API_KEY` locally. Jobs created at `/admin/x-lead-search` are claimed locally and written into the single `/admin/x-leads` candidate pool. Both manual and automatic sending select from that pool; neither sending mode runs its own search.

The Apify implementation and `.data/apify/runs/` history remain intact as a dormant fallback. It is used only when `X_LEAD_PROVIDER=apify` and `APIFY_ENABLED=true` are both explicitly configured; merely retaining `APIFY_API_TOKEN` does not activate it. `X_LEAD_PROVIDER=x-cookie` remains available for an explicit local-cookie rollback. There is no automatic provider fallback, so an invalid or exhausted TwitterAPI.io account cannot silently spend Apify credits.

Collection calculates engagement, account quality, recency, occasion, ownership, and US evidence from the source Post. Image analysis then decides whether the pet photo is suitable for a pillow. A lead reaches `review` only after passing both targeting and image checks. Manual review can correct occasion, ownership, and US evidence.

The dashboard records the audience segment on each lead and uses it in the default marketing campaign name, so the five scenes can be compared through the existing payment attribution funnel.

## Safety boundary

- Only operator-owned accounts with locally imported cookies. Cookies stay under `X_USE_HOME`.
- Discovery remains read-only. Public replies require exact-text, per-item administrator approval.
- No DMs, unreviewed copy changes, batch cycles, proxy rotation, fingerprint spoofing, CAPTCHA handling, or challenge bypass.
- Every automatic item still requires exact-text administrator approval. Accounts use fixed routes; a missing, duplicate, or failed route blocks sending instead of falling back to a direct connection.
- CAPTCHA, Cloudflare, authentication failure, or persistent throttling pauses collection.
- Original images and mockups are removed after seven days. Anonymous statistics and suppression records remain.
- Routine tests mock X and do not authenticate to X.
