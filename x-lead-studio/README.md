# X Lead Studio

Local acquisition workbench. It binds to `127.0.0.1:8020`, keeps discovery data in `.data/`, and can execute individually approved, scheduled X posts or replies through a separate local x-use data directory. It never uploads X cookies to the website or Supabase.

## macOS setup

```sh
cd /Users/f/Documents/DiyProject/x-lead-studio
/Users/f/.local/bin/python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m patchright install chromium
cp .env.example .env
./run.sh
```

The service binds only to `127.0.0.1:8020`. Keep `X_REPLY_EXECUTION_MODE=observe` until one specific task is explicitly authorized for a real test. Store `X_REPLY_WORKER_SECRET` locally with a password manager or encrypted file; do not paste it into chat or commit it. No launchd job is enabled during initial observe validation.

## Reviewed x-use automatic posts and replies

Install and check the pinned x-use release:

```sh
cd /Users/f/Documents/DiyProject/x-lead-studio
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m patchright install chromium
export X_USE_HOME="/Users/f/Library/Application Support/x-use"
.venv/bin/x-use init
.venv/bin/x-use doctor
```

Import only accounts you operate. Each x-use `account_id` must match the account key entered at `/admin/x-accounts`. Cookies and browser data remain under `X_USE_HOME` and are never included in worker heartbeats.

For IPRoyal ISP exports, check the route before binding an account: `.venv/bin/python check_iproyal_proxy.py --file /private/proxies.txt --host YOUR_PROXY_IP`. The export may contain the default HTTP port `12323`; the worker's SOCKS5 route uses `12324`. The check confirms both the proxy's egress IP and read-only access to X. Keep the export and credentials outside Git.

Set the same dedicated `X_REPLY_WORKER_SECRET` on the website and in this worker's `.env`, then run `./run.ps1`. The workflow is:

1. An administrator creates the exact post or reply draft and selects one account.
2. The administrator approves that individual draft only after the bound executor, local account and network policy are healthy.
3. `observe` mode reports x-use availability, configured account IDs and a cookie-free Patchright browser egress, but always receives HTTP 204 and never claims a task.
4. In `send` mode, `vpn_direct` requires the live Patchright egress to match the administrator-locked VPN IP. `fixed_proxy` performs a read-only x-use `test_proxy` before the job is claimed. Neither mode can fall back to another route.
5. The account-page “open X profile” action is also executed by the Mac worker. It opens the expected signed-in profile through that account's bound route and keeps the visible Patchright window available for up to about 10 minutes; manually closing the window ends inspection immediately. Only that account's writes pause while inspection is active.
6. Every X post/result link on the automatic queue is opened by the bound Mac worker, never by a direct browser link. The worker verifies the local account and exact bound egress before showing the target status; confirmation actions remain locked until that inspection completes.
7. After a fixed proxy's browser egress is first confirmed, later profile checks and automatic writes must return the same IP. A changed IP marks the route unhealthy and blocks the write.
8. Immediately before the write, the route is checked again. Only then may x-use create its own pending draft (`post_tweet` or `reply_to_tweet`), verify the draft ID, and call `approve_draft` for that same approved text.
9. `/admin/x-manual-posts` is a separate manual-only queue. It never reaches this worker and only records operator-confirmed results.
10. The website records `sent`, `failed`, or `uncertain`. Claimed or uncertain writes are never automatically retried.

No server-side LLM key is required because the approved text is passed explicitly.

## First-phase audience

Automatic collection supports five pet-owner scenes: `new_adoption`, `pet_birthday`, `pet_adventure`, `pet_costume`, and `pet_portrait`. Each run splits the configured limit across the selected scenes.

TwitterAPI.io uses a dedicated two-stage read-only path:

1. Broad `Latest` photo searches collect recent scene-matching posts and deduplicate authors.
2. Authors without reliable Post or profile location evidence are enriched through `/twitter/user_about`; `account_based_in` is cached locally for 30 days before targeting is recalculated.

Geo-only `place_country:US` searches are disabled by default because geo-tagged posts are rare. They can be restored with `TWITTERAPI_GEO_QUERY_ENABLED=true`, with the old allocation controlled by `TWITTERAPI_US_QUERY_SHARE`. About enrichment is controlled by `TWITTERAPI_ABOUT_ENRICHMENT_ENABLED` and `TWITTERAPI_ABOUT_CACHE_DAYS`.

Every successful TwitterAPI.io response page is atomically archived under `.data/twitterapi/runs/<job-id>.json` before result-limit truncation, deduplication, photo checks, location targeting, or business/ad filtering. The archive also records the minimal About enrichment result and whether it came from cache or the API. The API key and request headers are never archived. Cached About results live in `.data/twitterapi/user-about-cache.json`.

Before submitting a discovered candidate, the worker now checks each attached image with a vision model and selects an image only when it shows a real, clearly visible cat or dog matching the post. Cartoons, people posing as pets, screenshots, ads, and unclear images are excluded. The default verifier uses the local Ollama `qwen3.5:4b` vision model (`ollama pull qwen3.5:4b`); configure `OLLAMA_URL` and `OLLAMA_VISION_MODEL` if needed. `PET_IMAGE_VERIFIER=openai` uses the existing `VISION_API_KEY` and `VISION_MODEL` settings instead. If the verifier is unavailable, the discovery job stops without submitting unverified candidates; archived source responses remain available for replay. The candidate's `targeting_data.image_verification` records the selected photo and verifier.

For historical rows whose account origin is still missing, run `backfill_twitterapi_locations.py` with the relevant X handles. It reuses the 30-day cache, rate-limits `user_about` calls, and reports an individual lookup error without discarding the rest of the batch. The script only returns location evidence; it does not update the candidate database or perform any X write action.

The default daily limit is 40 candidates across both segments. Change it with `AUTO_COLLECTION_DAILY_LIMIT`. A candidate needs a US-confidence score of at least 70 by default. Candidates without enough public location evidence remain in `location_review`; pet businesses, shelters, ads, and adoption listings are put in `rejected_targeting`.

The hosted admin queues use one shared discovery worker. Set the same `X_LEAD_WORKER_SECRET` on the website and in this worker's `.env`, then set `TWITTERAPI_API_KEY` locally. Jobs created at `/admin/x-lead-search` are claimed locally and written into the single `/admin/x-leads` candidate pool. Both manual and automatic sending select from that pool; neither sending mode runs its own search.

The Apify implementation and `.data/apify/runs/` history remain intact as a dormant fallback. It is used only when `X_LEAD_PROVIDER=apify` and `APIFY_ENABLED=true` are both explicitly configured; merely retaining `APIFY_API_TOKEN` does not activate it. `X_LEAD_PROVIDER=x-cookie` remains available for an explicit local-cookie rollback. There is no automatic provider fallback, so an invalid or exhausted TwitterAPI.io account cannot silently spend Apify credits.

Collection calculates engagement, account quality, recency, occasion, ownership, and US evidence from the source Post. Image analysis then decides whether the pet photo is suitable for a pillow. A lead reaches `review` only after passing both targeting and image checks. Manual review can correct occasion, ownership, and US evidence.

The dashboard records the audience segment on each lead and uses it in the default marketing campaign name, so the five scenes can be compared through the existing payment attribution funnel.

## Safety boundary

- Only operator-owned accounts with locally imported cookies. Cookies stay under `X_USE_HOME`.
- Discovery remains read-only. Public replies require exact-text, per-item administrator approval.
- No DMs, unreviewed copy changes, unapproved batch cycles, proxy rotation, fingerprint spoofing, CAPTCHA handling, or challenge bypass.
- Every automatic item still requires exact-text administrator approval. `vpn_direct` uses only the macOS system VPN; `fixed_proxy` uses one non-rotating route per account. A missing, duplicate, changed, or failed route blocks sending.
- Administrators can approve multiple prepared drafts in one batch. The worker still sends serially, preserves the daily first-send confirmation gate, and waits a fresh random 15–30 seconds after each confirmed send before claiming the next item. Each account independently rests for 45 minutes after its own 12th confirmed send; that rest does not block other accounts. Configure x-use with `mcp.safety.write_interval_seconds: 15` so its local safety interval matches the worker.
- CAPTCHA, Cloudflare, authentication failure, or persistent throttling pauses collection.
- Original images and mockups are removed after seven days. Anonymous statistics and suppression records remain.
- Routine tests mock X and do not authenticate to X.
