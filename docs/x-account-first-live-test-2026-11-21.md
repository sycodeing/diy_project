# Account-first bounded live test — 2026-11-21

The account-first data path ran on one previously archived discussion seed. It produced **3 distinct account review rows, all `insufficient/no_entry/unreviewed`; 0 catalog-fit prospects, 0 drafts, 0 strict leads, 0 outreach**. The timeline did add personal context for two accounts, but independent AI text review found no specific, non-sensitive custom-pillow or face-towel use case. This is a small mechanism test, not evidence that the acquisition strategy improves conversion.

## Provenance and calls

- Seed: [post 2121966452974424257](https://x.com/AKDoodleBros/status/2121966452974424257), an original dog-on-couch discussion dated 2026-11-15 14:00:01 UTC with 3 replies in its archived metadata. The original source is `.data/twitterapi/runs/695f748c-ee34-46f7-8e8e-fd9cd72a4e90.json`. The video thumbnail was inspected only as seed context; it is not an owned photo for a participant.
- The first hosted account job `cd125300-1661-42bf-a80b-3d2070f2c5ad` fetched the exact seed (200) and received a provider 503 at the V1 reply endpoint. It remains **blocked**, with 0 account rows. The 503 response said it was not charged.
- One authorized V2 diagnostic fetched `/twitter/tweet/replies/v2` using `tweetId=2121966452974424257`, `cursor=''`, `queryType=Latest`: HTTP 200, one seed row and 3 direct replies. Its raw archive is `.data/twitterapi/runs/account-first-reply-v2-diagnostic-20261121T091402Z.json`. The seed row was excluded from participants. No second reply page was fetched despite `has_next_page=true`.
- A linked continuation reused the archived seed and V2 reply evidence, then requested exactly one `/twitter/user/last_tweets` page for each of those 3 authors. No seed, reply, or search request was repeated. All 3 timeline calls returned HTTP 200. Raw responses and pre-request attempt records are in `.data/twitterapi/runs/account-first-linked-resume-20261121T092009Z-1e959708.json`. Its source job was the blocked job, but the continuation has its own completed hosted job `18215d50-8493-45be-881d-29019742ebba` and source archive. The original blocked record was not rewritten.
- Timeline pages returned 60 within-window account entries: **26 original posts and 34 retweets** (per account 5/15, 1/19, 20/0). Retweets were not counted as the account's independent behavior evidence. The provider returned posts; account or media ownership was not externally verified. The contacted snapshot at 2026-11-21 09:20:04 UTC had 297 post IDs, 295 handles, 0 author IDs; none of the 3 fixed participants matched those exclusions. Handle fallback is a limitation when author IDs are absent.

## Account assessment

| Account | Reply-only evidence | Timeline increment | Product and entry result |
| --- | --- | --- | --- |
| A | Brief reaction to the seed | Five original pet-persona posts and 15 retweets | Social entry exists; catalog use unknown |
| B | Brief reaction with one photo URL | One short original post with photo metadata and 19 retweets | Pet/person identity and product use unverified; profile requests no DMs |
| C | Brief reaction with one photo URL | Twenty original posts support a pet relationship and personal creative activity; some posts involve bereavement | Product use unknown; avoid sensitive context as a commercial hook |

The frozen `account-first-v1` runtime classifier returned `insufficient/no_entry` for all three. Independent AI text and metadata review found richer pet context in two accounts, but **no non-sensitive specific product-use evidence**. It did not change runtime classifications or human review. All photo URLs are metadata only; neither image content nor ownership was visually verified. The detailed personal-text assessment and the 60-item ID/retweet audit stay in ignored `.data/purchase-discussion-evaluation/account-first-ai-review-20261121.json` (`reviewer=astra`, `reviewed_by_human=false`).

The linked job used the existing validated account completion route and service-role RPC. Database readback showed three unique account rows, all `unreviewed`, tied to the linked job and archive. The original job is still `blocked`. The account page is [this test batch](https://www.thebestdiyshop.com/admin/x-leads?mode=account_review&job=18215d50-8493-45be-881d-29019742ebba); it may require admin login. Final DB counts: `x_leads=841`, `x_lead_raw_reviews=400`, `x_reply_jobs=163`, `x_lead_account_reviews=3`, and 0 queued/running discovery jobs. No approval or sending action was called.

## Cost and repair

The observed provider balance moved from 24,130 credits before this bounded test to 23,140 on two later reads: **990 credits net for the whole test interval**. Immediately before the three timeline calls it was 24,040; the immediate after-call read was also 24,040, then two later reads were 23,140, an observed delayed 900-credit decrease. Provider charges cannot be reliably assigned to every earlier attempt from these balance snapshots. Conservative reserved exposure for the completed continuation and prior attempts was 2,160 credits, below the authorized 2,400-credit cap and 3,000-credit floor. No further paid call was made after the three timelines.

The production account probe used V1 replies, which returned 503 in this test. It now requests V2 with `Latest`, requires the expected conversation ID, excludes the returned seed row and seed author, deduplicates reply posts, and preserves nested replies as context pending. A focused regression covers the V2 response shape and unrelated-thread exclusion. The V2 endpoint fix addresses this observed technical failure; **a new hosted job after the fix has not been run**, so the site's future end-to-end yield remains untested. No classifier threshold was relaxed to make these accounts appear qualified.
