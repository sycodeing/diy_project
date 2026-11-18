# X acquisition search probe — 2026-11-18

Scope: read-only TwitterAPI query-only probes. One page per expression, at most two parent reply-page calls per discussion probe, no account enrichment, photo verification, database import, queue changes, or X replies. Each successful provider page was archived before filtering. Probe watermarks are isolated from production.

## New discussion-source hypothesis

Search for a relevant custom pet-photo pillow post first, then inspect direct buyer replies with the exact parent as context. Only a parent whose text establishes a pet, a pillow/cushion, and customization/photo context can trigger a reply-page call. The reply must contain a buyer request. Nested replies and the parent author are excluded.

| Archive ID | Query revision | Parent search rows | Relevant parents | Direct replies read | Text-intent passes |
| --- | --- | ---: | ---: | ---: | ---: |
| `purchase-intent-demand_discussion-20261118T022648Z-7a7c2c76` | v1 exact phrase | 0 | 0 | 0 | 0 |
| `purchase-intent-demand_discussion-20261118T022820Z-3c3a2025` | v2 product terms | 0 | 0 | 0 | 0 |
| `purchase-intent-demand_discussion-20261118T022959Z-df9a8635` | v3 broad pet/pillow terms | 20 | 0 | 0 | 0 |

The v3 first page was mostly pet sleeping/pillow jokes, unrelated products, and other noise. It had `source_exhausted=false`; later pages were intentionally not fetched. No real reply-page call occurred, so provider behavior for that endpoint is covered by mocked tests and provider documentation only.

## Gift-question comparison

Archive `purchase-intent-demand_gift-20261118T023058Z-0e5cab8e` used one page each of v8-lover, v8-recipient, and new v9-question. It returned 0, 7, and 19 rows respectively (26 distinct posts before later author gates). The live v5 classifier marked one v9 post as an intent pass. Manual inspection showed it was a keychain shop advertisement, not a buyer. The seller-language regression was fixed in v6; offline replay of the same 26 posts now yields **0 text-intent passes** (23 `no_current_product_request`, 3 `seller_or_giveaway`). None reached location, ownership, photo, or human-qualified status.

Provider bonus balance was 32,560 before these probes and 31,825 after settlement, a **735-credit observed net decrease**. This is an account-balance difference, not a per-endpoint bill; concurrent provider activity cannot be ruled out. No production cursor was advanced.

## Sitter-gift hypothesis and second evaluation

An older archived post described an owner buying a gift for the person who regularly watches their cat. It was neither a current request nor a qualified lead. To test whether this was a repeatable source, revision `v10-sitter` searched for cat/dog/pet sitter gift advice in the most recent three days. The new narrow classifier accepts a first-person request for a gift for the sitter of the author's own cat or dog only as `gift_exploration`; it does not infer a request for a custom pillow. The separate parent-reply regression now rejects an explicit “not a pillow” even when the parent advertises one.

Archive `purchase-intent-demand_gift-20261118T061057Z-5bb9a4e3` contains the sole paid v10-sitter query: Latest, one page, `resultLimit=20`, isolated watermark. The provider returned **0 posts**, `source_exhausted=true`, 0 text passes, and 0 candidates. No account-origin, photo, import, or outreach step ran. Bonus balance was 31,855 before and after the probe; settlement remained pending at the last check, so the observed difference of zero does not establish a zero charge. The different balance from the earlier probe is not attributed to this query.

The second evaluation found no new, distinct query hypothesis supported by a genuine current buyer request. Widening the sitter query or repeating earlier gift/pillow searches would expand the same unproductive hypotheses. Revision `v10-sitter` is available only by explicit `queryRevisions` selection and is excluded from the normal `demand_gift` query plan. **Acquisition effect: not qualified.** There are 0 genuinely relevant request accounts in this probe, 0 fully qualified leads, and no verified outreach or conversion. Further paid search should start only after a new recent buyer request or a relevant parent thread supplies a specific, repeatable search pattern.

## Decision

The parent-first collector and scene-specific first-contact drafts are implemented and locally tested, but these probes did not produce a qualified person. Do not schedule or scale these expressions based on raw matches. The `demand_discussion` option remains manually selected and requires discovery worker 1.12.0+; the hosted job action rejects it if an older worker is online. The existing hosted photo and US evidence gates still apply. A separate demand-signal path for text-only buyers and reply monitoring remain unimplemented, so this change does not establish an automatic search-to-outreach funnel.
