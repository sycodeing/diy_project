# Strict X pet candidate batch

## Scope and baseline

1. Establish the requested batch size and exclusion horizon. Record exact source job IDs and a baseline of distinct `post_id` and `author_hash`; do not mix an earlier batch into the new count. Inspect current review statuses and past contacted/suppressed accounts before searching.
2. Discovery is read-only. Enqueue only discovery jobs; do not call outreach, queue, reply, DM, follow, or approval actions. A user's request for 50 candidates does not authorize sending 50 messages.
3. Confirm the actual worker/provider and image verifier are available. If vision verification cannot run, fail closed rather than equating an HTTPS image URL with a pet photo.

## Acquire and reuse evidence

- Search bounded, distinct owner/scene slices with `Latest` and a suitable lookback. Generic pet-photo discovery uses photo filtering; purchase-demand search accepts text-only posts and joins a same-account photo later. Keep TwitterAPI base queries short enough for provider limits (historically below about 440 characters); split dog/cat or scene slices rather than using one huge OR query. Check per-segment watermark before backfills; snapshot it before changing it. Do not repeatedly burn quota on overlapping broad results.
- The worker archives every successful response page in `.data/twitterapi/runs/<job-id>.json` before filtering. Preserve archives when a job fails so a schema/logic repair can replay them without refetching. Never store API keys/cookies in an archive or report.
- Use normalized case-insensitive account handles and the timestamped `.data/twitterapi/user-about-cache.json` (default freshness 30 days, configurable in `config.py`). Apply fresh account-origin evidence even when the profile self-reports a US city/state: a credible non-US origin can reveal a conflict. Requery stale/missing evidence only when needed. Historical archives and trustworthy prior account evidence may supplement the cache, but preserve source, fetched time, and accuracy; do not promote an old `us_evidence` summary or “North America” to confirmed US.
- For every candidate post, consider the available photo attachments (up to four), verify the actual image as an original cat/dog photo matching the inferred pet type, and retain the specific verified `media_url`. Worker 1.8.0 uses `best-preview-photo-v2`: inspect all attachments, require explicit preview usability and integer quality >=70, select the highest score (ties retain attachment order). Record per-photo assessments; missing quality fields fail closed. Dark, blurred or obscured pet photos are not suitable merely because the species is identifiable. Historical `verified` evidence without this policy is not proof of preview quality; recheck when needed. This is a model judgment, not human approval, and can require up to four vision calls per post.

## Purchase-demand scenes

- Keep this mode separate from generic pet discovery. Default queries: `demand_custom`, `demand_gift`, `demand_decor`; `demand_recommendation` remains a compatible custom-demand query. Actual scene comes from current post evidence, not the query label. Each post gets one primary scene, with gift purpose taking precedence over decor.
- Require a current request/wish about a relevant custom pet product, or a photo/personalized gift; birthday/adoption, generic pet affection, and toy/treat requests alone do not qualify. Preserve the original matched sentence, tier, scene and classifier version. US, ownership, advertising, sensitive-context and human-review gates remain mandatory.
- For demand mode, text-only requests are expected. v3 accepts tightly linked adjacent sentences, but an unrelated pet sentence cannot supply buyer intent. `ownership_evidence_pending` is only an intermediate state: confirm ownership from the same account's caption before submission, and keep the selected image tied to its source post.
- Apply the text-intent and obvious ad/organization checks before paid account-origin enrichment. An unsuitable image in the demand post may fall back to an archived or newly fetched same-account photo; reverify the chosen image and its source each time. Never treat an image URL or a photo of an unrelated pet as ownership proof.
- Compare `query_slices` counts for each search expression (received, unique, intent rejected, targeting rejected, intent passed) before spending on a larger query. These counts are retrieval diagnostics, not final qualified yields. Query revision v3 uses separate watermark keys so old broad-query cursors cannot hide posts from the first revised run. Quote buyer/product phrases, keep queries short, and validate provider behavior with a bounded live batch only after explicit screening authorization.
- `qualifiedPerScene` defaults to 20 (use 10 for a three-scene target of 30); `resultLimit` is a separate bounded RAW retrieval budget, not a promise of qualified counts. Prefer recent 3-day posts before a justified bounded extension. Never backfill a deficient scene with generic pet owners.
- Deduplicate across scenes by account. `scene_submitted` and `scene_submission_gap` are BEFORE hosted historical/contact deduplication. Audit final new rows by source job and scene after completion; these metrics alone do not prove 20 new people in each group. Respect the finite provider budget instead of automatic refetching to meet quotas.

## Hard gates and review

- Require distinct `post_id` and `author_hash`, plausible owner language, non-organization/non-ad signals, US evidence with the configured threshold (currently 70), and `targeting_data.image_verification.result = verified` with `media_url` equal to the verified URL.
- Exclude `location_review`, `rejected_targeting`, `rejected`, suppressed/contacted rows, explicit non-US origins, origin/profile conflicts, ambiguous regions, and missing image verification from the final list. Keep ambiguous rows for audit instead of silently changing them to US or deleting them.
- `approved` means human-approved; `new` and `targeting_review` can be shortlisted but still need human review before outreach. Do not call the entire shortlist approved.
- Prefer direct/current account-origin or explicit US profile evidence, clear pet ownership, useful occasion, recent posts, and a suitable verified image. If an evidence label is generic (for example `profile_location_state` without a state or source detail), inspect the underlying evidence or leave it out of a strict exported batch. Balance cat/dog or scenes only when enough qualified supply exists; do not lower hard gates to meet a target number.

## Iterate and deliver

1. Monitor each job until completed/blocked. Inspect raw → unique → address-enriched → image-checked/verified → inserted → strict-qualified conversion, provider errors, duplicates, and cache hit/miss rates. Fix a demonstrated bottleneck, add a regression test, then compare a later job; do not infer improvement from one noisy batch.
2. If qualified supply is short, expand to a genuinely different owner/scene slice or a guarded depth/backfill pass. Keep a finite query budget and stop for login, CAPTCHA, rate/credit limits, or persistent provider failures. Never fabricate 50 from uncertain rows.
3. Select the requested number from strict-qualified rows, one post per account, and export an inspectable list with post URL, chosen media URL, pet type, US evidence, review status, source job, and a brief post excerpt. Verify row/post/author counts and that no selected row has `location_review`. Record reserve candidates separately. Keep the export local unless publishing was requested.

SQL audit shape (replace the job IDs; adapt review states to current schema):

```sql
select count(*) as rows,
       count(distinct post_id) as posts,
       count(distinct author_hash) as authors,
       count(*) filter (where media_url = targeting_data->'image_verification'->>'media_url') as chosen_verified_images
from public.x_leads
where source_job_id in ('<job-id>')
  and selection_status in ('new', 'targeting_review', 'approved')
  and us_confidence >= 70
  and targeting_data->'image_verification'->>'result' = 'verified';
```

The SQL count is a candidate-pool audit, not proof that a human reviewed every post or that any X outreach happened.
