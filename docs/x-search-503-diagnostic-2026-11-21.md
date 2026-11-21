# X source search 503 diagnostic — 2026-11-21

The API **was called**. The acquisition search endpoint remained TwitterAPI.io `GET /twitter/tweet/advanced_search`; the separate reply lookup had previously changed to V2. This diagnostic made no candidate job, import, approval, or outreach action.

The earlier home-source request used `Latest`, an empty cursor, and query `("my living room" OR "my bedroom") (decor OR wall OR pillow) -filter:replies lang:en`. It was sent at **10:54:26 UTC**, and returned HTTP 503 at **10:55:05 UTC**, after 39.25 seconds, with provider detail `This search couldn't be completed right now. Please retry in a few seconds. You were not charged.` Its [raw archive](../x-lead-studio/.data/twitterapi/runs/account-home-seed-search-20261121T105424Z-9c77b82c.json) contains the request and response. That one-off helper called the endpoint once with a 120-second client timeout. The production `lead_studio/twitterapi.py` page fetcher has a separate four-attempt bounded retry path; it was not invoked by that helper. A 503 is an error, not an empty successful search.

The authorized technical comparison used the same base URL, endpoint, configured key, 120-second client timeout, `Latest`, and empty cursor. Every request attempt was archived before the call, with its full non-secret response and safe response headers afterward:

| Attempt | Query | Result | Elapsed | Meaning |
| --- | --- | ---: | ---: | --- |
| D1 · 14:49:41–14:49:45 UTC | `pillow` | HTTP 200, 20 raw tweets | 4.047 s | The endpoint, credential, and `Latest` path returned data at that moment; these are not buyer leads. |
| D2 · 14:49:46–14:49:57 UTC | original complex home query above | HTTP 503 | 11.547 s | The original expression failed again; it did not return an empty tweet page. |
| D3 · 14:52:29–14:52:38 UTC | `my living room` | HTTP 503 | 8.718 s | Removing quotes, OR, filters, and date constraints did **not** produce a working home-source response in this test. |

[D1/D2 raw archive](../x-lead-studio/.data/twitterapi/runs/search-503-diagnostic-20261121T144940Z-d101d3e7.json) · [D3 raw archive](../x-lead-studio/.data/twitterapi/runs/search-503-d3-20261121T145228Z-e6e55a04.json)

All three 503 bodies gave the same provider detail quoted above. The captured safe headers had `date` and `server: cloudflare`, with no request ID or `Retry-After`. They do not disclose the internal cause. D1/D2/D3 occurred at different times and contain different terms, so the comparison cannot establish an OR-parser fault, a universal `Latest` fault, or a reliable short-query fix. The 503s were actual HTTP responses well before the 120-second client timeout; they were not local timeout exceptions. D3 had no OR, quotes, remote date, or filter, so none of those is a necessary cause of the observed failures. D3 yielded no raw source posts, so there are no recent/local-match/reply-positive source counts to report from it. The provider's [error-handling guide](https://twitterapi.io/blog/twitter-api-error-handling-best-practices) treats 5xx as retryable provider/upstream errors. Its [public status page](https://twitterapi.io/status) showed the service operational at review time; that aggregate status does not negate these individual failed requests.

The balance was 23,080 credits before D1, 23,080 immediately after D1/D2, and 22,780 before and immediately after D3; a later free balance read still showed **22,780**. The observed decrease is 300 credits; delayed billing means this does not allocate a final cost to individual requests. Three diagnostic attempts each reserved at most 300 credits, meeting the authorized 900-credit exposure cap and 3,000-credit floor. No further paid request or automatic retry was made after D3 failed. A final read-only database check showed 841 strict leads, 400 raw reviews, 3 account reviews, and 0 active discovery jobs, unchanged from the pre-diagnostic baseline.

The proposed reusable short-query source-search entry was conditional on D3 returning a valid page. That condition did not occur, so no production search strategy or retry policy was changed. A future source-search experiment would need its own bounded authorization and should keep raw responses, error and empty-result states, and local scene filtering distinct.

## Provider support draft — prepared, not sent

To: `hello@twitterapi.io` ([official contact page](https://twitterapi.io/contact))

Subject: `Partial advanced_search 503: simple query succeeds, home queries fail`

We are calling `GET https://api.twitterapi.io/twitter/tweet/advanced_search` with the same API key and HTTP client for each request, `queryType=Latest`, `cursor=` and a 120-second timeout. No remote time range was added. On 2026-11-21 UTC we observed:

1. 10:54:26–10:55:05: `query=("my living room" OR "my bedroom") (decor OR wall OR pillow) -filter:replies lang:en` → HTTP 503 after 39.25 seconds.
2. 14:49:41–14:49:45: `query=pillow` → HTTP 200 with 20 `tweets` after 4.047 seconds.
3. 14:49:46–14:49:57: original complex query above → HTTP 503 after 11.547 seconds.
4. 14:52:29–14:52:38: `query=my living room` → HTTP 503 after 8.718 seconds.

All three 503 responses said: `This search couldn't be completed right now. Please retry in a few seconds. You were not charged.` The diagnostic responses had no request ID or `Retry-After` header. Could you inspect the server-side logs for these UTC windows and explain whether the failures originated in query execution, an upstream dependency, or another cause? In particular, the unquoted three-word query failed while the unrelated one-word query succeeded. Please confirm how charges for the four attempts settled. We can provide the full non-secret response bodies and encoded request URLs from our local archives. No API key or customer data is included in this draft.
