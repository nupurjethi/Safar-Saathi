# Mock travel API (MakeMyTrip-style, sample data)

Base path `/api/mock/v1`. All inputs are validated with Zod. Responses carry `notice: "Sample data. Not live inventory."` where relevant. Catalogue endpoints are public; booking, quote and change endpoints need a session cookie.

| Method and path | Purpose | Auth |
|---|---|---|
| `GET /itineraries?q=&dest=&tier=&nights=&budget=&theme=&from=&sort=&page=&pageSize=` | Search with facets and pagination. Returns `{ total, page, pageSize, items[], facets }` | no |
| `GET /itineraries/:slug?start=YYYY-MM-DD&pax=` | Detail: days, cities, hotels, pois and a priced breakdown (`pricing.breakdown`, `pricing.totalInr`) | no |
| `GET /flights/search?from=&to=&date=&pax=&anchor=depart\|arrive` | Alternative flights on a route and local day | no |
| `GET /stays/availability?hotelId=&checkin=&nights=&rooms=` | Extra-night availability and per-night price | no |
| `POST /quotes` | `{ bookingRef, kind: "flight_change" \| "hotel_extend", params }` → review card payload: before, after, `priceDeltaInr`, rules, expiry, `blocked` | yes |
| `POST /bookings` | `{ ref, travellers[], payment }` pays for a selected draft, or `{ slug, startDate, travellers[], payment }` selects and pays in one call | yes |
| `POST /changes/apply` | `{ quoteId, token }`. **Requires a valid single-use confirmation token** from `POST /api/confirmations` | yes |
| `GET /bookings/:ref` | Booking record and confirmed items | owner |

`POST /quotes?chaos=price_move` (only when `DEMO_MODE` is not `false`): moves the price by 5 to 15 % between quote and apply, so the first apply returns `409 PRICE_CHANGED` with a fresh quote.

## Errors

JSON `{ "error": CODE, "message": "…" }`. Gate codes: `NO_TOKEN` 401, `TOKEN_INVALID` 401, `TOKEN_EXPIRED` 401, `TOKEN_USED` 409, `TOKEN_MISMATCH` 403, `QUOTE_EXPIRED` 410, `QUOTE_NOT_OPEN` 409, `QUOTE_TAMPERED` 409, `OVER_LIMIT` 403, `PRICE_CHANGED` 409 (with `newQuote`), `NO_AVAILABILITY` 409, `CHANGE_WINDOW_CLOSED` 409, `FORBIDDEN` 403, `UNAUTHENTICATED` 401, `RATE_LIMITED` 429.

## Prototype rules for changes

- A flight can move to another time **on the same travel day** (outbound: same arrival day).
- A hotel extension applies to the **last stop**, 1 to 3 nights. The return flight (cheapest seat-available option that day) and the airport drop-off move with it, and are priced in the same quote.
- Price = change fee per traveller + any fare increase (a cheaper new fare is not refunded) for flights; sample room rates for hotel nights.

## Other endpoints

`POST /api/confirmations`, `POST /api/confirmations/decline`, `POST /api/agent` (NDJSON stream) and `GET /api/agent?bookingRef=`, `GET /api/packs/:id/manifest`, `GET /api/packs/:id/pack`, `GET /api/trips`, `GET /api/trips/:ref/log` (action log), `POST /api/sos`, `POST /api/sms/inbound` (gateway webhook, signature checked), `POST|GET /api/sms/sim` (staff), `GET /api/admin/cases`, `POST /api/admin/cases/:id/take`, `POST /api/admin/reset`, `GET /api/health`, `GET /api/weather` (online-only proxy), `POST /api/events`.

## Revision v2 endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/trips/select` `{ slug, startDate, pax }` | Select a trip: creates the draft and builds its offline bundle (details, rules, routes, map references) before any payment |
| `POST /api/trips/:ref/pay` `{ travellers[], payment }` | Dummy payment: confirms the draft. Does not start a download |
| `POST /api/cases` `{ localId, queuedAt, bookingRef, scenario? }` | Upload an SOS saved on the phone. Idempotent by `localId` |
| `POST /api/providers/manual` `{ kind, reference }` | Record a reference the traveller booked elsewhere. Nothing is fetched |

Quotes (`POST /quotes`, `quote_change`) now return `breakup[]` (lines in ₹), `totalInr` (equal to the sum), `source`, `validUntil` and `refundable`. A quote whose lines do not add up is rejected. Changes need a booked trip (`409 NOT_BOOKED` on a draft).
