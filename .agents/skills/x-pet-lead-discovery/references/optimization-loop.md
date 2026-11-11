# Automatic optimization during a screening run

The skill applies this loop without waiting for a separate “优化” request when the user asks to screen X pet candidates. It is run-scoped decision-making, not an unattended daemon. Do not start a new provider job for a request that only asks to inspect or change the skill.

## Measure before choosing a change

1. Read the most recent completed jobs for the same provider/configuration (up to 10), their archived query slices, `metrics`, and current `x_leads` review outcomes. Separate the current requested batch from prior candidates. Count distinct posts and distinct authors after deduplication.
2. For each comparable job compute `strict_qualified / unique_posts`, `image_verified / image_checked`, `about_cache_hits / about_candidates`, address-uncertain count, rejected-targeting count, and duplicate-account count. Use safe zero-denominator handling. A job containing several query slices has job-level yield; do not claim a per-slice conversion rate unless the archive and candidate linkage actually support it.
3. Read a small sample of failed and human-rejected items, including every newly observed false positive pattern when feasible. Record the concrete reason, not only a percentage. Human decisions supersede automated ranking; never auto-approve previously rejected accounts.

## Pick the next bounded adjustment

Choose the most evidenced bottleneck and change one lever at a time, then compare a later completed job with a comparable baseline:

| Observed bottleneck | Preferred adjustment | Invariant |
| --- | --- | --- |
| Many duplicate posts/accounts | Use a distinct owner/scene slice or guarded older-depth query; preserve watermark snapshot | Do not inflate the candidate count with duplicates |
| Many missing or ambiguous locations | Apply fresh historical account-origin cache first; inspect conflicting/stale evidence; selectively enrich missing accounts | Never infer US from language or “North America”; keep US threshold |
| Many image rejections or poor chosen first photo | Inspect the rejected-image sample and all available attachments; fix a demonstrated verifier/selection issue with tests | Real matching cat/dog photo remains mandatory |
| Many targeting or human-review rejections | Group rejection reasons, tighten the offending phrase/account rule, and replay archived pages before refetching | Do not silently change human statuses |
| Qualified yield is good but target is short | Reuse the best evidenced query slices and reserve a small, distinct exploration slice | Bound provider calls to the remaining gap and available quota |

If the sample is too small or slices are not comparable, record the uncertainty and retain the current rule instead of declaring a winner. Prefer a reversible query/ranking adjustment before modifying production code. Code-level changes require a regression test and a subsequent completed-job check; a local test alone does not prove production improvement.

## Stop and record

- Before each additional fetch, calculate the remaining strict-qualified gap, proposed query/result limits, expected overlap, and provider budget. Stop when the requested count is reached, the bounded plan is exhausted, or authentication/CAPTCHA/rate/credit errors occur. Never broaden address, image, account, or human-review gates merely to reach a number.
- In the batch report, record baseline and new funnel counts, cache reuse, the one adjustment attempted, the observed result or lack of comparable evidence, remaining uncertain rows, and the next hypothesis. Reuse that report on the next invocation; if a local optimization log exists, append only non-secret aggregate metrics and decisions to it.
- “Automatic optimization” means this measured loop runs as part of the screening invocation. It does not create a scheduled task, silently spend provider credits between chats, auto-edit/deploy code, or send outreach.
