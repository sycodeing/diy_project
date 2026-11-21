# Account-first home and personal-image source test — 2026-11-21

This bounded test **did not produce a new participant to assess**. The frozen home search stopped on a provider 503. A separate, explicitly revised exploration reused one archived personal-art discussion as a seed; its single V2 reply page contained only the seed and its author's own reply. There were **0 external reply authors, 0 timeline calls, 0 account review rows, and 0 drafts or outreach**. These are source-supply and API observations, not evidence that the account-first screening strategy improved or failed commercially.

## Frozen search and historical reuse

The two pre-registered `Latest`, empty-cursor queries used a local seven-day window, without remote time or reply-count filters:

1. `("my living room" OR "my bedroom") (decor OR wall OR pillow) -filter:replies lang:en`
2. `("my photo" OR "our photo" OR "my dog" OR "my cat") (printed OR framed OR portrait) -filter:replies lang:en`

The first query made one `/twitter/tweet/advanced_search` attempt at 2026-11-21 10:54 UTC. It returned HTTP 503 after 39 seconds with the provider message that the search could not be completed and was not charged. Its [local raw archive](../x-lead-studio/.data/twitterapi/runs/account-home-seed-search-20261121T105424Z-9c77b82c.json) retains the exact request and response. The second query was not called; the original search trial remains a technical stop with **no search-result sample**.

Without another provider call, we inspected the ten most recent completed search archives with real tweet pages, excluding failed and duplicate diagnostic runs. Their search pages contained 524 returned post rows and 471 distinct post IDs. Using the exact 2026-11-14 10:54 to 2026-11-21 10:54 UTC window, 452 distinct posts were recent; 157 had positive `replyCount`, and 100 of those were original, non-retweet posts. This is a historical source review, **not 452 new API posts or 100 suitable sources**. Most relevant-looking posts were sellers, sensitive contexts, quotes of others' material, ordinary pet talk, or unrelated uses of home/photo/product terms.

The initial source rule required an already displayed physical item and found no eligible source in those ten archives. On review, that rule was narrower than the authorized potential-audience hypothesis. A personal original artwork plus an explicit intention to turn it into a framed print is a plausible *personal image to physical display* discussion source even before printing. Under this **revised exploratory rule**, archived [post 2123396551431049329](https://x.com/i/web/status/2123396551431049329) was the sole source selected: original post dated 2026-11-19 12:42 UTC, `replyCount=1`, artwork photo metadata, and no sales or commission language in the post or profile. The archived source is `consumer-recall-20261120T070129Z-ded6365a.json`. It involves another person's character art; rights, image provenance, geography, and fit to this shop's pillow cover or face towel remain unknown. The source author's interest is **not evidence about any reply author**. This rule revision was made after the failed search, so it is not a result of the frozen search trial.

## One revised-source account job

Manual account-first job `43996f26-5a7c-4ef2-b64d-3b062b521376` ran under discovery worker 1.19.1. Its verification note records the archived AI source check, the revised exploratory hypothesis, unknown catalog fit and participant identity, and no human approval. The [job archive](../x-lead-studio/.data/twitterapi/runs/account-first-20261121T110112Z-73899c17.json) shows exactly two successful provider requests:

| Request | Raw result | Account result |
| --- | --- | --- |
| Exact seed lookup | HTTP 200, one seed post | Context only |
| V2 reply page, `Latest`, empty cursor | HTTP 200, two rows: the seed and post `2123397612111880445`, a direct self-reply by the seed author | Both excluded from external participants |

The V2 response reported `has_next_page=true`; the fixed test allowed only one reply page. Therefore the observation is **zero external participants on the fetched page**, not proof that the whole thread has no other replies. No timeline was requested, no account was enriched, and no participant's product interest was inferred from the seed. The job completed with `returned_reply_page_items=2`, `returned_replies=0`, `distinct_reply_authors=0`, and `account_review_rows=0`.

## Cost, storage, and limits

Across both phases there were three paid-endpoint attempts: the 503 search, exact seed lookup, and one V2 reply page. Conservative reserved exposure was 300 + 315 = 615 credits, below the authorized 2,400-credit round cap and 3,000-credit balance floor. The provider said the 503 was not charged. Balance reads were 23,140 before the round and immediately after the 503, 23,125 immediately after the account job, and **23,080 on a later read**: 60 credits of observed net decrease. The reads do not reliably allocate cost to each successful request or prove that all delayed charges have settled.

Database readback after completion: the new job is `completed`, with zero rows attributed to it; active discovery jobs 0; account review rows 3 (all pre-existing); strict `x_leads` 841; raw reviews 400; reply jobs 163. No send, approval, or strict-candidate path was invoked. The original provider-error archive was not rewritten. Detailed original post text, profile data, media references, and API payloads remain in ignored local archives and were not copied into this report.

The next source hypothesis, if separately tested, should allow real personal visual work with a concrete physical-display intention, while excluding seller, fictional, sensitive, and merely imagined life scenes. An eligible seed is only a discussion entry: a reply author still needs independent personal evidence, product-use evidence, and a non-sensitive current conversational opening. This round supplied no external reply author, so it cannot measure that account-level funnel or predict purchases.
