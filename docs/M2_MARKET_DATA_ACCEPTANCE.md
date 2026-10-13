# M2 Phase 1 market-data acceptance

Scope: **FR-020, partial FR-022 and partial FR-024** (AI-020 in the
implementation plan). This phase adds informational BTC-EUR/ETH-EUR quotes to
the authenticated Markets page. M1 portfolio initialization and accounting are
preserved.

## Requirement mapping

| Requirement | Phase behavior |
| --- | --- |
| FR-020 | A typed server adapter reads only the fixed public Coinbase Advanced Trade product and ticker endpoints for BTC-EUR and ETH-EUR. No Coinbase key or authenticated account access. |
| FR-022, quote validation only | Validate product identity, decimal values, prices, bid/ask consistency and available exchange timestamps. Reject malformed/incomplete required data; mark stale data unusable and hide its numeric display. Daily candles and gap validation remain for the next phase. |
| FR-024, initial market page | Authenticated Markets cards show price, 24-hour change, base-asset volume and available bid/ask, with retrieval and last-trade times, freshness, loading and error states. Poll while the page is visible. |

No portfolio valuation is inferred from this feed. FR-012 timestamped portfolio
marking, FR-021 candle ingestion, historical storage and the remaining FR-022
candle validation are outside this phase.

## Public data contract and timestamps

The fixed upstream origin is `https://api.coinbase.com`, using:

- `GET /api/v3/brokerage/market/products/{product_id}` for product reference
  price, 24-hour percentage change and volume.
- `GET /api/v3/brokerage/market/products/{product_id}/ticker` for recent trades
  and available best bid/ask.

Coinbase documents these as public methods that require no JWT. [REST endpoint
guidance](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api).
The returned financial values remain decimal strings, bounded to 20 integer
and 20 fractional digits with 40-digit decimal arithmetic. Prices and present
bid/ask must be positive; volume may be zero. Percentage input may include a
trailing `%`, which is normalized into the percentage-valued string. Calendar
timestamps must be valid UTC strings ending in `Z`. Missing optional
information is explicitly unavailable rather than fabricated.

`fetchedAt` is the server's actual retrieval time for the price's endpoint.
`exchangeAt` preserves the timestamp of the validated trade used as the price;
when the provider omits it, it remains null. It is never substituted with the
application clock and does not timestamp the untimestamped bid/ask snapshot.
This distinction follows the trade objects in Coinbase's [public market trades
contract](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/public/get-public-market-trades).

If ticker transport fails or its validated trades list is empty, a validated
product price can be returned with `priceKind: "reference"` and
`exchangeAt: null`. The UI identifies it as a reference and shows no exchange
time. If product transport fails, a valid ticker may supply its last-trade
price, with product statistics unavailable. Present malformed JSON or schema
data fails closed even if the other endpoint is valid. Old or future-dated
trades are marked stale and never silently replaced by a reference. The fallback
is an independent validated upstream value with no fabricated price or time.
See the [public product
contract](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/public/get-public-product).

## Freshness, caching and failures

- The server caches successful snapshots for 60 seconds per product in each
  warm process and shares an in-flight request among simultaneous consumers.
  Product and ticker requests run in parallel, each with at most three attempts
  and a three-second timeout including the body. Retry delays are 250/500
  milliseconds plus up to 100 milliseconds of jitter.
- Failure and stale snapshots are cached for 30 seconds. `Retry-After` delays
  up to two seconds are waited within retries; longer 429/5xx headers hold both
  products until the full provider cooldown expires. Browser refreshes do not
  bypass cache or cooldown.
- A quote is stale at an age of **120 seconds**, using retrieval time and the
  known last-trade time independently. A timestamp more than five seconds in
  the future also marks the quote stale. Invalid date formats fail validation.
  A product reference has no invented exchange age.
- The browser polls `/markets/data` approximately every 60 seconds while
  visible, with no overlapping requests and at least 60 seconds between
  attempts. A five-second freshness/deadline check normally gives a
  60–65-second cadence after a visibility-triggered refresh. Freshness ages
  locally between polls so an old value cannot remain presented as fresh
  indefinitely.
- Initial page loading uses a skeleton. Cards show Recent fetch, Stale or
  Unavailable badges and automatic-retry error text. Numeric quotes are hidden
  when stale or unavailable. A failed refresh immediately marks a prior quote
  stale while preserving its timestamps, even if its age alone is below the
  limit. Failure of one product does not invent a price for it or erase the
  other product's independently valid state.

The adapter accepts only the two allowed products and a fixed upstream origin;
browser input cannot select arbitrary upstream URLs. Financial values are
validated before caching and rendering. Errors expose sanitized categories
instead of credentials or raw provider response bodies.

## Authentication, database and deployment

`/markets` and `/markets/data` independently verify the existing Supabase user.
The JSON route is an authenticated application endpoint, even though its
upstream market data is public. Browser polling uses the application route;
Coinbase fetching stays on the server.

No additional secrets or configuration are required beyond the existing public
Supabase URL/publishable key used for authentication. Existing RLS and M1 RPCs
remain intact. This phase adds **no migrations, database writes, portfolio
funding, market-history storage, BUY/SELL actions, Cron or live capability**.
The already-applied portfolio migration is neither replayed nor duplicated.
Read-only hosted verification confirmed exactly one unchanged DRY_RUN
portfolio, one `INITIAL_CAPITAL` entry of `+500.000000000000` EUR and zero
BTC/ETH. No hosted writes or migration replay occurred in this phase.

## Validation record

Local validation completed on 13 October 2026. The full required suite passed;
native concurrency and the separate live public API smoke check also passed.
Default gates use deterministic fixtures and preserve M1 regression coverage:

| Command | Result |
| --- | --- |
| `npm run lint` | Passed. |
| `npm run typecheck` | Passed strict TypeScript checks. |
| `npm test` | 378 tests passed across 13 files. |
| `npm run test:concurrency` | Passed using an isolated native PostgreSQL cluster. |
| `npm run test:e2e` | All 30 browser tests passed. |
| `npm run build` | Production build passed. |
| `npm run test:markets:live` | One public API smoke test passed for both BTC-EUR and ETH-EUR. |

```bash
npm run lint
npm run typecheck
npm test
npm run test:concurrency
npm run test:e2e
npm run build
```

Market fixtures cover both allowed products, decimal precision, missing or
malformed values, mismatched products, unavailable bid/ask, timestamps, stale
boundaries, timeout/network failures, 429 with retry delays, server errors,
cache expiry, concurrent request sharing and failure cooldown. Browser coverage
verifies protected reads, success/error/stale states, polling timeouts/recovery,
no overlapping requests and preservation of the existing portfolio flow. The polling
regression checks no early request at 59 seconds and the next attempt by 65
seconds after a visibility-triggered refresh.

### Corrections and regression coverage

- Zero prices and bid/ask are rejected at both the upstream schema and browser
  polling boundaries. Regression cases confirm no zero or NaN quote is shown.
- The upstream request deadline includes response-body reading; failed bodies
  are cancelled and timed-out requests are aborted. Tests cover body stalls,
  retries and recovery without retaining a usable-looking previous quote.
- The server supplies the initial render clock explicitly, preserving render
  purity while the client clock advances for freshness and polling.
- Polling checks its deadline every five seconds, fixing a missed next poll
  after a visibility-triggered refresh while preserving the 60-second minimum
  and in-flight guard.
- Virtual-clock browser tests model polling time and HTTP deadlines separately.
  They complete valid intercepted responses before advancing through their
  deadlines and move only the system date for the in-flight overlap scenario.
  Production timeouts remain active; a dedicated test leaves a request pending
  until its real client timeout cancels it, then verifies recovery.

An optional current-provider smoke test is separate from the default suite and
CI because it requires network access:

```bash
npm run test:markets:live
```

It reads only the public product/ticker contracts and uses no credentials or
database. Network, upstream schema or rate-limit failures remain visible; a
fixture response cannot turn this live-read validation into a false pass.

## Manual acceptance

1. Logged out, visit `/markets` and `/markets/data`. Confirm the page redirects
   to login and the data route denies an unauthenticated response without
   exposing market payloads through the private application.
2. Sign in as the existing owner. Open `/markets` and confirm BTC-EUR and
   ETH-EUR cards use real public data, currency/unit labels and explicit source,
   retrieval time and available last-trade time. Confirm no sample values.
3. Check 24-hour changes, base BTC/ETH volumes and available EUR bid/ask. A
   product-price fallback must be labeled as a reference with unknown exchange
   time; unavailable fields must not appear as zero.
4. Keep the page visible for a full poll interval (normally 60–65 seconds).
   Verify successful automatic updates and no overlapping requests. Hide the
   tab, return after more than two minutes and confirm freshness is reevaluated
   instead of retaining an old Recent fetch label.
5. Use isolated fixtures to exercise delayed responses, timeout, 429, invalid
   data and one-product outage. Confirm clear loading/error/retry states, hidden
   stale/unavailable numeric quotes and preservation of the other product's
   valid display. Do not alter hosted records to simulate failures.
6. Check desktop/mobile layout and keyboard navigation. Use browser refresh and
   navigate back to the dashboard, then log out/in; confirm EUR 500, zero BTC/ETH
   and zero cumulative initial P&L remain unchanged. LIVE stays locked.

## Delivery and next scope

The authorized phase workflow is commit, push, PR and merge only after local
validation and required GitHub checks pass, then synchronize clean local main.
The final report records actual Git results; this document does not assert a
merge before it occurs.

Recommended next requirement: **FR-021**, UTC daily candle ingestion, paired
with the remaining FR-022 historical-candle validation (AI-021).
