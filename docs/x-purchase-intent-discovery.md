# Parallel pet demand discovery v1

## Scope

Legacy photo/occasion discovery is unchanged. The new bounded manual entry on
`/admin/x-lead-search` creates an independent job with `discoveryMode=purchase_intent`
and `demand_*` segments. It does not save, enable or overwrite the legacy schedule.
Both modes coexist; the existing single worker processes jobs serially, not concurrently.
Deploy the web app and restart the discovery-only worker (version 1.7.0+) before use.

## Rules

- Explicit current requests for pet custom products/recommendations: priority 80.
- Expressed wish for pet-photo decor: exploration priority 50 (unchecked by default).
- A score is a rule rank, not a conversion probability or permission to contact.
- Product + pet + personalization + request/wish must appear in the same short sentence.
- Ordinary pet photos, birthdays and adoption posts alone do not qualify.
- Exclude seller/giveaway, already-purchased, negative/hypothetical, urgent delivery,
  illness, loss and fundraising contexts. These conservative regex rules require human
  context review; they do not understand every language construction.
- Retain existing ownership, noncommercial, public US >=70, location-conflict checks,
  actual pet image verification and per-author deduplication. Generic state-only evidence
  and pending locations are not submitted by demand jobs.
- v1 deliberately retains the existing photo requirement. Text-only shopping requests
  are not covered; do not describe this mode as comprehensive buyer discovery.
- All candidates remain human-review-only. Nothing sends, auto-approves or changes queues.

## Evidence and parallel operation

Reuses the existing account-origin cache, photo attachments/verifier and raw page archive.
`demand_*` cursor keys never advance legacy cursor keys. Cloud rows use the existing
`custom` segment, with the precise query segment and versioned `purchase_intent` evidence
inside `targeting_data`. Filter `/admin/x-leads?mode=purchase_intent` for the new mode;
`?mode=legacy` for old-mode membership. Shared posts are not duplicated; a legacy refresh
preserves their demand signal. Existing human decisions and metadata are preserved.
Cross-author history checks and blacklists remain shared; no duplicate contact permission.

## Bounded experiment

Default: two explicit-request slices, 60 raw results total, seven-day lookback.
60 raw results does not promise 30 qualified people. No automatic refill or schedule.
Record raw, intent-rejected, location-pending, image-checked/verified, duplicate and
inserted counts. Keep exploration and explicit-request outcomes separate. Review
matched original text before contact; inspect pet photo suitability as in the existing skill.
Evaluate actual conversations, preview actions and confirmed payments, not raw redirects.
Do not lower evidence gates to meet a daily contact quota.

Local regression tests/mock completed jobs establish implementation behavior only.
Real provider yield, human intent accuracy and purchase conversion need a later bounded
live job and reviewed outcomes; no conversion improvement is claimed by this change.

## Initial offline check (2026-11-13)

Replayed seven existing 2026-11-12 archives with `audit_purchase_intent.py`: 617 unique
posts, zero matching demand signals. 565 had no current product request; other reason
counts overlap (urgent 19, sensitive 25, negative/hypothetical 9, seller/giveaway 2).
This is old-query sample evidence, not evidence of zero market demand or new-query yield.
It is not a new deliverable candidate batch and consumed no provider requests.

```powershell
cd x-lead-studio
.\.venv\Scripts\python.exe audit_purchase_intent.py .data/twitterapi/runs/<job-id>.json
```
