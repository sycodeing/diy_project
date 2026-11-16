# Purchase intent screening audit — 2026-11-16

Scope: read-only, local archive review. No candidate import, outreach, or second search-page fetch followed the targeted parent lookup.

## Evidence and yield

Seven search archives (six earlier jobs plus the latest bounded probe) contain 167 returned rows. Deduplicating their raw pages by post ID leaves 139 posts from 127 accounts. The current `pet-demand-v5` text classifier excludes all 139; no text-intent match is present. This is an offline text diagnostic, not a US, ownership, image, or human-review qualification result.

| Search archive ID | Status | Returned rows |
| --- | --- | ---: |
| `695f748c-ee34-46f7-8e8e-fd9cd72a4e90` | completed | 25 |
| `034fcfbe-0f09-4791-9204-77ce9480a851` | completed | 11 |
| `522359d7-cfc4-4d90-8984-54bb8a5a8eb1` | completed | 52 |
| `dc8032ed-2dea-478d-aea0-800a3722f876` | completed | 22 |
| `172f00b2-e311-4d4a-a39b-db8b1bd89a42` | partial; four raw rows retained | 4 |
| `8628bb23-8081-4780-91b2-a8617106b3aa` | completed | 21 |
| `purchase-intent-v1111-20261116T093517Z-869f8147` | completed | 32 |

The latest probe's reply `2121635218562199615` says “can you make one for my cat” but lacked product context. Its exact parent `2121499515727364112` was fetched once through `GET /twitter/tweets?tweet_ids=2121499515727364112`. The complete response is preserved at `.data/twitterapi/runs/reply-parent-2121499515727364112-raw.json` (SHA-256 `AE8DFD46A898D85E3BB31B54E830EEDDA1DFF1235CB164FA634143F5D0C9C9FD`). The parent says “Look what I made !” and quotes an unrelated ferret-image account; its text supplies no custom pet photo pillow context. This reply remains excluded. US location, ownership-photo, and preview-image gates were not satisfied or claimed.

The balance check was 32,575 bonus credits before the exact parent request and 32,560 after delayed settlement: **15 credits** for that request. This does not price the earlier search jobs.

## Change and decision

The five parent lookups per job now prioritize replies that explicitly request an item for “my/our dog/cat/puppy/kitten.” A regression test places such a reply at position 18 and confirms it is checked first. A fetched but unsuitable parent is recorded as `reply_parent_product_mismatch`; an unfetched parent remains `reply_parent_context_required`. These tests establish ordering and rejection behavior only. They do not demonstrate improved qualified yield or customer acquisition.

Stop paid purchase-intent searching for this round. The archived sample provides no evidence to justify expanding the query budget. Any future search plan requires a new, distinct hypothesis and its own bounded authorization.
