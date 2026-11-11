# Demo script (3 minutes), workflow v2

Follows the end-to-end test in `tests/e2e/trip.spec.ts`. Run `npm run db:reset && npm run build && npm start`. Say "sample data" once, early. With no `LLM_API_KEY` the guide is the *Standard guide* (template rules) and the agent is the labelled demo agent; with a key, the guide says *Guide generated for this trip. Checked against your booking.*

**0:00 · Catalogue (home).** "100+ sample trips, every card tagged Sample." Search "Bali", pick a trip. On the detail page point at the day plan, the price breakup and **"Offline guide: about N MB, takes about 30 seconds on 4G"**.

**0:30 · Select, before paying.** Tap **Select this trip** (sign in as Neha if asked). A *Draft · not paid yet* banner appears and the offline guide downloads: **trip details, rules and routes**, then **map files**. It ends on **Offline guide ready · v1**, plus the label under it (generated or standard).

**1:00 · Airplane mode, still unpaid.** Switch the network off. The badge says **Offline pack**. Open **Guide → Can't find my hotel**: the address in local script, tap for the full-screen card. Open **Map**: saved route, blue dot (Show my location), OpenStreetMap attribution. Open **SOS**: the address card and emergency number come first, then **Queue SOS** ("Saved on this phone. Will send when you are back online. SMS needs cellular signal."). Tap Queue SOS.

**1:35 · Back online.** The queued SOS uploads by itself: **"Case sent. Reference SS-C-…"**.

**1:50 · Book.** Open the trip → **Book this trip** → travellers → **Test pay** (no money moves). Payment confirms the booking; it does not download anything, because the guide is already on the phone.

**2:05 · The agent proposes, you decide.** Agent tab: "Please move my flight later." You get an **option list**: each option shows old and new flight, the **price breakup** (lines add up to the total), the **source** ("Sample data (mock API)") and a **validity time**, with **Yes** and **No**. Tap **Yes** on one. Nothing happened before that tap; the server checks a single-use token and the live price. (Tick *Demo: move the price* first to show `409 PRICE_CHANGED` and a fresh option list.)

**2:35 · The guide updates itself.** The receipt says **Offline guide updated to version 3** and lists the refreshed scenarios. Only the flight-related ones are redrafted. Open **Guide → Flight delayed**: it shows the new flight. Go offline again: it still works.

**2:50 · Human side.** Sign in as Admin → **SMS simulator**: `SOS lost passport SS-48213` → "Severity 1. Human paged. Case ID SS-C-…". **Case inbox** shows both severity-1 cases with SLA countdowns.

Reset between runs: Admin → Reset demo data. The scroll story is at `/story`.
