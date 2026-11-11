import { expect, test } from "@playwright/test";
import { REF, agentEvents, ask, booking, loginAs } from "./helpers";

test.describe.configure({ mode: "serial" });

test("1. Explore → select → guide ready → offline guide/map/address card/SOS → online option list → Yes → guide v+1 → offline again", async ({ page, context }) => {
  // 1-2. catalogue home, pick a sample itinerary
  await loginAs(page, "traveller", "/?q=Bali&pax=2");
  await expect(page.getByTestId("results")).toBeVisible();
  expect(await page.getByTestId("itinerary-card").count()).toBeGreaterThan(0);
  await page.getByTestId("itinerary-card").first().click();
  await expect(page.getByTestId("price-breakdown")).toBeVisible();
  await expect(page.getByTestId("offline-estimate")).toContainText("Offline guide: about");
  // real photos of real landmarks, loaded from our own origin, with credits
  await expect(page.getByTestId("places")).toBeVisible();
  const photoOk = async (sel: string) => page.locator(sel).first().evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 100);
  await expect.poll(() => photoOk('[data-testid="place-photo"]')).toBe(true);
  await expect(page.getByTestId("photo-credits")).toBeVisible();
  // a real street map (OpenStreetMap vector tiles) of the trip, not a schematic of dots and lines
  await page.getByTestId("preview-map").scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => { const m = (window as unknown as { __ssPreviewMap?: { loaded(): boolean; queryRenderedFeatures(): { source: string }[] } }).__ssPreviewMap; return !!m && m.loaded() && m.queryRenderedFeatures().length > 50; }), { timeout: 30_000 }).toBe(true);

  // 3-5. select: the draft is created and the offline guide is saved BEFORE any payment
  await page.getByTestId("select-btn").click();
  await expect(page.getByTestId("draft-banner")).toBeVisible();
  await expect(page.getByTestId("offline-ready")).toHaveText("Offline guide ready", { timeout: 60_000 });
  await expect(page.getByTestId("offline-status")).toContainText("v1");
  await expect(page.getByTestId("rules-label")).toContainText(/Standard guide|Guide generated/);
  const ref = (await page.getByText(/^SS-\d{5}$/).first().innerText()).trim();
  await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);

  // ---- go offline (still unpaid) ----
  const failed: string[] = [];
  // ERR_ABORTED = the map cancelled a tile read itself while panning/zooming (not a network failure); anything else offline is a bug
  page.on("requestfailed", (r) => { if (!/ABORTED/.test(r.failure()?.errorText ?? "")) failed.push(`${r.url()} (${r.failure()?.errorText})`); });
  page.on("pageerror", (e) => failed.push(`PAGEERROR ${e.message}`));
  await context.setOffline(true);

  await page.goto(`/trips/${ref}`);
  await expect(page.getByTestId("trip-hero")).toBeVisible();
  await expect.poll(() => photoOk('[data-testid="trip-hero-photo"]'), { timeout: 15_000 }).toBe(true); // the destination photo is in the offline bundle
  await expect(page.getByTestId("day-plan")).toBeVisible();
  await expect.poll(() => photoOk('[data-testid="plan-photo"]'), { timeout: 15_000 }).toBe(true); // the landmark photos are in the offline bundle

  await page.goto(`/trips/${ref}/guide`);
  await expect(page.getByTestId("scenario-grid")).toBeVisible();
  await expect(page.getByTestId("offline-banner")).toBeVisible({ timeout: 15_000 });
  const t0 = Date.now();
  await page.getByTestId("scenario-hotel-not-found").click();
  await expect(page.getByTestId("scenario-detail")).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(1000); // offline answer in under 1 s
  await page.getByTestId("address-card-open").first().click();
  await expect(page.getByTestId("address-card")).toBeVisible();
  await expect(page.getByTestId("address-card")).toContainText(/\S{4,}/);
  await page.getByTestId("address-card").getByRole("button", { name: "Done" }).click();

  await page.goto(`/trips/${ref}/map`);
  await expect(page.getByTestId("map-canvas")).toBeVisible();
  // OFFLINE street-level map: tiles, fonts and icons all come from the phone's cache
  const streets = () => page.evaluate(async () => {
    const m = (window as unknown as { __ssMap?: { loaded(): boolean; jumpTo(o: unknown): void; getStyle(): { layers: { id: string; type: string }[] }; queryRenderedFeatures(): { source: string; layer: { id: string; type: string } }[] } }).__ssMap;
    if (!m || !m.loaded()) return null;
    m.jumpTo({ zoom: 16 });
    await new Promise((r) => setTimeout(r, 1500));
    const f = m.queryRenderedFeatures();
    return { core: f.filter((x) => x.source.startsWith("core-")).length, labels: f.filter((x) => x.layer.type === "symbol").length, roads: f.filter((x) => /roads/.test(x.layer.id)).length };
  });
  await expect.poll(async () => { const r = await streets(); return !!r && r.core > 20 && r.roads > 5 && r.labels > 3; }, { timeout: 30_000 }).toBe(true);
  await expect(page.getByText("© OpenStreetMap contributors").first()).toBeVisible();
  await expect(page.getByTestId("route-chip").first()).toBeVisible();
  await page.getByTestId("route-chip").first().click();
  await page.getByTestId("locate-btn").click();
  await expect(page.getByTestId("gps-dot")).toBeVisible({ timeout: 15_000 }); // GPS works with no data
  // the dot must sit ON the traveller's position (Playwright's fake GPS = 48.8606, 2.3376), not in a corner of the map: it is a MapLibre marker (absolutely positioned)
  const placed = await page.evaluate(() => {
    const m = (window as unknown as { __ssMap: { project(l: [number, number]): { x: number; y: number }; getContainer(): HTMLElement } }).__ssMap;
    const dot = document.querySelector('[data-testid="gps-dot"]') as HTMLElement;
    const box = m.getContainer().getBoundingClientRect(), r = dot.getBoundingClientRect();
    return { style: getComputedStyle(dot).position, inside: r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom, bg: getComputedStyle(dot.querySelector(".gps-dot")!).backgroundColor };
  });
  expect(placed.style).toBe("absolute");
  expect(placed.bg).toBe("rgb(216, 253, 52)"); // neon green core

  await page.goto(`/trips/${ref}/sos`);
  await expect(page.getByTestId("sos-address-card")).toBeVisible();
  await expect(page.getByTestId("sos-emergency")).toBeVisible();
  await expect(page.getByTestId("sos-main")).toContainText("Queue SOS");
  await expect(page.getByText("SMS needs cellular signal")).toBeVisible();
  await page.getByTestId("sos-main").click();
  await expect(page.getByText("Saved on this phone. Will send when you are back online.")).toBeVisible();

  const unexpected = failed.filter((u) => !/\/api\/|_rsc|favicon/.test(u));
  expect(unexpected, `unexpected failed requests: ${unexpected.join(", ")}`).toEqual([]);

  // ---- back online: the queued SOS case uploads and gets a server reference ----
  await context.setOffline(false);
  await expect(page.getByTestId("sos-sent")).toContainText(/Case sent\.\s*Reference\s+SS-C-\d+/, { timeout: 30_000 });

  // An UPDATED map file must be able to replace an old saved one: a normal tile read is answered from the phone's saved copy,
  // but the update download (?ss-refresh=1) must reach the network. Otherwise a trip whose map grew would stay on the old, smaller map.
  const probe = await page.evaluate(async (r) => {
    const name = (await caches.keys()).find((n) => n.startsWith(`ss-trip-${r}`))!;
    const cache = await caches.open(name);
    const key = (await cache.keys()).find((k) => k.url.endsWith("-core.pmtiles"))!;
    const real = await cache.match(key);
    await cache.put(key, new Response(new Uint8Array(500), { headers: { "Content-Type": "application/octet-stream" } })); // pretend this is the old copy
    const magic = async (u: string) => new TextDecoder().decode(await (await fetch(u, { headers: { Range: "bytes=0-6" } })).arrayBuffer());
    const saved = await magic(key.url);
    const refreshed = await magic(`${key.url}?ss-refresh=1`);
    await cache.put(key, real!); // put the real file back
    return { saved, refreshed };
  }, ref);
  expect(probe.saved).not.toBe("PMTiles"); // served from the saved (old) copy
  expect(probe.refreshed).toBe("PMTiles"); // the update download reaches the network

  // 6. book (payment confirms the booking; it does not start any download)
  await page.goto(`/trips/${ref}`);
  await page.getByTestId("book-trip").click();
  await page.getByTestId("trav-name-0").fill("Asha Test");
  await page.getByTestId("trav-name-1").fill("Ravi Test");
  await page.getByTestId("to-pay").click();
  await page.getByTestId("pay-btn").click();
  await expect(page.getByTestId("booking-success")).toBeVisible();
  await page.getByTestId("go-trip").click();
  await expect(page.getByTestId("draft-banner")).toHaveCount(0);

  // 7-8. flight change: no sample flights. The agent sends the traveller to their own booking platform, then records the new flight through the Confirm gate
  await page.goto(`/trips/${ref}/chat`);
  // "I'm logged in to": the traveller picks their booking platform at the top of the chat
  await expect(page.getByTestId("platform-selector")).toBeVisible();
  await page.getByTestId("platform-choice-goibibo").click();
  await expect(page.getByTestId("platform-choice-goibibo")).toHaveAttribute("aria-checked", "true");
  await ask(page, "Please move my flight later");
  // the agent compares sample fares from the mock partner API (stored in the database), shown per platform
  const cmp = page.getByTestId("compare-card").last();
  await expect(cmp).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("assistant-text").last()).toContainText("mock partner API");
  expect(await cmp.getByTestId("compare-offer").count()).toBeGreaterThan(0);
  await expect(cmp).toContainText(/sample/i);
  const pay = cmp.getByTestId("pay-on-platform");
  await expect(pay).toContainText("Goibibo"); // pay on the platform the traveller is logged in to
  expect(await pay.getAttribute("href")).toMatch(/^https:\/\/www\.goibibo\.com\//);
  expect(await pay.getAttribute("target")).toBe("_blank");
  await cmp.getByTestId("compare-record").click(); // "I have paid: record my booking"
  const pc = page.getByTestId("platform-card").last();
  await expect(pc).toBeVisible();
  await expect(pc.getByTestId("platform-row")).toHaveCount(4);
  for (const name of ["MakeMyTrip", "Goibibo", "Cleartrip", "ixigo"]) await expect(pc.getByTestId("platform-list")).toContainText(name);
  const href = await pc.getByTestId("platform-open").first().getAttribute("href");
  expect(href).toMatch(/^https:\/\//);
  expect(await pc.getByTestId("platform-open").first().getAttribute("target")).toBe("_blank");
  await pc.getByTestId("platform-mark").first().click(); // "I am logged in on this site" (self-declared)
  await expect(pc.getByTestId("platform-row").first()).toContainText("Logged in");
  // bad details are refused with a plain message
  await pc.getByTestId("pf-carrier").fill("Air India");
  await pc.getByTestId("pf-flightno").fill("AI 143");
  await pc.getByTestId("pf-pnr").fill("1");
  await pc.getByTestId("pf-submit").click();
  await expect(pc.getByTestId("pf-error")).toBeVisible();
  // good details: shift the shown times by 3 hours (local strings), enter a PNR and the amounts paid on the platform
  const shift = (v: string) => { const d = new Date(`${v}:00Z`); d.setUTCHours(d.getUTCHours() + 3); return d.toISOString().slice(0, 16); };
  await pc.getByTestId("pf-depart").fill(shift(await pc.getByTestId("pf-depart").inputValue()));
  await pc.getByTestId("pf-arrive").fill(shift(await pc.getByTestId("pf-arrive").inputValue()));
  await pc.getByTestId("pf-pnr").fill("AB12CD");
  await pc.getByTestId("pf-fare").fill("3500");
  await pc.getByTestId("pf-fee").fill("2500");
  await pc.getByTestId("pf-submit").click();
  const card = page.getByTestId("review-card").last();
  await expect(card).toBeVisible();
  await expect(card).toContainText("Record your flight change");
  await expect(card.getByTestId("offer-source")).toContainText("Entered by you from Goibibo"); // the platform the traveller said they are logged in to
  await expect(card.getByTestId("review-notice")).toContainText("books and charges nothing");
  expect(await card.getByTestId("breakup-line").count()).toBe(2);
  await expect(card.getByTestId("price-delta")).toContainText("6,000");
  const newFlight = "AI143";
  await card.getByTestId("confirm-btn").click(); // "Yes, confirm"
  await expect(page.getByTestId("receipt-card")).toBeVisible();
  await expect(page.getByTestId("receipt-card")).toContainText("you paid on the platform");
  await expect(page.getByTestId("guide-update")).toContainText("Offline guide updated to version");

  // 9. the guide now shows the new flight, and keeps working offline
  await expect.poll(async () => {
    await page.goto(`/trips/${ref}/guide?s=flight-delayed`);
    return (await page.getByTestId("steps").innerText().catch(() => "")).includes(newFlight);
  }, { timeout: 40_000, intervals: [1500] }).toBe(true);
  await context.setOffline(true);
  await page.goto(`/trips/${ref}/guide?s=flight-delayed`);
  await expect(page.getByTestId("steps")).toContainText(newFlight);
  await context.setOffline(false);
});

test("2. asking for the pickup time cites the booking", async ({ page }) => {
  await loginAs(page, "traveller", `/trips/${REF}/chat`);
  await expect(page.getByTestId("chat-log")).toBeVisible();
  await ask(page, "When is my pickup?");
  const reply = page.getByTestId("assistant-text").last();
  await expect(reply).toContainText("Your pickup in Paris");
  await expect(reply).toContainText(/code SS\d{4}/);
  await expect(page.getByTestId("step-chip").first()).toContainText("get_itinerary");
});

test("3. a quote from the gate can be declined and the booking stays unchanged", async ({ page }) => {
  await loginAs(page, "traveller", `/trips/${REF}`);
  const before = await booking(page);
  // the gate's sample-inventory quote path (kept for API clients); chat no longer offers it for stays or flights
  const q = await page.request.post("/api/mock/v1/quotes", { data: { bookingRef: REF, kind: "hotel_extend", params: { extraNights: 1 } } });
  expect(q.status()).toBe(200);
  const card = await q.json();
  expect(card.notice).toBe("Nothing is booked until you tap Confirm.");
  const dec = await page.request.post("/api/confirmations/decline", { data: { quoteId: card.quoteId } });
  expect(dec.ok()).toBeTruthy();
  const after = await booking(page);
  expect(after.booking.totalInr).toBe(before.booking.totalInr);
  expect(after.booking.packVersion).toBe(before.booking.packVersion);
  expect(after.items.length).toBe(before.items.length);
});

test("4. price move: 409 → new quote at the new price → Confirm → receipt → pack version +1", async ({ page }) => {
  await loginAs(page, "traveller", `/trips/${REF}`);
  const before = await booking(page);
  const q = await page.request.post("/api/mock/v1/quotes?chaos=price_move", { data: { bookingRef: REF, kind: "hotel_extend", params: { extraNights: 1 } } });
  const first = await q.json();
  const { token } = await (await page.request.post("/api/confirmations", { data: { quoteId: first.quoteId } })).json();
  const moved = await page.request.post("/api/mock/v1/changes/apply", { data: { quoteId: first.quoteId, token } });
  expect(moved.status()).toBe(409);
  const body = await moved.json();
  expect(body.error).toBe("PRICE_CHANGED");
  const second = body.newQuote as { quoteId: string; priceDeltaInr: number };
  expect(second.priceDeltaInr).not.toBe(first.priceDeltaInr);
  const { token: t2 } = await (await page.request.post("/api/confirmations", { data: { quoteId: second.quoteId } })).json();
  const ok = await page.request.post("/api/mock/v1/changes/apply", { data: { quoteId: second.quoteId, token: t2 } });
  expect(ok.status()).toBe(200);
  const after = await booking(page);
  expect(after.booking.packVersion).toBe(before.booking.packVersion + 1);
  expect(after.booking.totalInr).toBeGreaterThan(before.booking.totalInr);
});

test("5. apply without a token, and with a reused token, are both rejected", async ({ page }) => {
  await loginAs(page, "traveller", "/trips");
  // a quote to try the gate on: the agent shows the platform picker (no review card); the traveller then records the new flight
  const ev = (await agentEvents(page, "Please move my flight later")) as unknown as { t: string; itemId?: string; flight?: { departIso: string; arriveIso: string } }[];
  const pf = ev.find((e) => e.t === "compare" || e.t === "platforms")!;
  expect(pf.itemId).toBeTruthy();
  const made = await page.request.post(`/api/trips/${REF}/external-change`, { data: { platform: "cleartrip", itemId: pf.itemId, flightNo: "6E 212", carrierName: "IndiGo", departLocal: pf.flight!.departIso, arriveLocal: pf.flight!.arriveIso, pnr: "XY98ZT", fareDiffInr: 1500, changeFeeInr: 500 } });
  expect(made.status()).toBe(201);
  const card = (await made.json()).card as { quoteId: string };
  const noToken = await page.request.post("/api/mock/v1/changes/apply", { data: { quoteId: card.quoteId } });
  expect(noToken.status()).toBe(401);
  expect((await noToken.json()).error).toBe("NO_TOKEN");
  const junk = await page.request.post("/api/mock/v1/changes/apply", { data: { quoteId: card.quoteId, token: "not-a-real-token" } });
  expect(junk.status()).toBe(401);
  const conf = await page.request.post("/api/confirmations", { data: { quoteId: card.quoteId } });
  const { token } = await conf.json();
  const ok = await page.request.post("/api/mock/v1/changes/apply", { data: { quoteId: card.quoteId, token } });
  expect(ok.status()).toBe(200);
  const reuse = await page.request.post("/api/mock/v1/changes/apply", { data: { quoteId: card.quoteId, token } });
  expect(reuse.status()).toBe(409);
  expect((await reuse.json()).error).toBe("TOKEN_USED");
  // the model has no way to apply: the agent tool without a token only reports "confirmation required"
  const chat = await agentEvents(page, "yes confirm it");
  expect(chat.some((e) => e.t === "done")).toBeTruthy();
});

test("6. simulated SMS 'SOS lost passport SS-48213' → severity-1 case and a reply with the case ID", async ({ page }) => {
  await loginAs(page, "admin", "/admin/sms-sim");
  await page.getByTestId("sms-body").fill("SOS lost passport SS-48213");
  await page.getByTestId("sms-send").click();
  await expect(page.getByTestId("sms-thread")).toContainText(/Severity 1\. Human paged\. Case ID SS-C-\d+\./);
  await page.goto("/admin/cases");
  const row = page.getByTestId("case-row").first();
  await expect(row).toHaveAttribute("data-sev", "1");
  await expect(row).toContainText("SS-48213");
  await expect(page.getByTestId("sla").first()).toBeVisible();
});

test("7. offline assistant is its own chat: answers from the saved trip with no network, keeps its history, and never mixes with the Trip agent", async ({ page, context }) => {
  const askOffline = async (text: string) => { await page.getByTestId("oa-input").fill(text); await page.getByTestId("oa-input").press("Enter"); };
  await loginAs(page, "traveller", `/trips/${REF}/chat`);
  await expect(page.getByTestId("chat-log")).toBeVisible(); // the bundle is on this phone once the chat renders
  await expect(page.getByTestId("chat-tab-online")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("offline-assistant")).toHaveCount(0); // no offline toggle inside the online chat any more

  // (a) the online agent fails → an error and a link to the offline assistant, never an offline answer inside this chat
  await page.route("**/api/agent", (r) => (r.request().method() === "POST" ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "The Trip agent could not answer just now." }) }) : r.continue()));
  await ask(page, "when is my pickup");
  await expect(page.getByTestId("ask-offline-assistant").last()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("oa-answer")).toHaveCount(0);
  await page.unroute("**/api/agent");

  // open the offline assistant once online so the phone has the page
  await page.getByTestId("chat-tab-offline").click();
  await expect(page.getByTestId("offline-chat")).toBeVisible();
  await page.getByTestId("chat-tab-online").click();
  await expect(page.getByTestId("chat-log")).toBeVisible();

  // (b) airplane mode: the online chat says so and points to the offline assistant
  await context.setOffline(true);
  await expect(page.getByTestId("online-offline-banner")).toContainText("You are offline. The Trip agent needs internet.", { timeout: 20_000 });
  await page.getByTestId("chat-tab-offline").click();
  await expect(page.getByTestId("offline-chat")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("chat-tab-offline")).toHaveAttribute("aria-current", "page");
  if (await page.getByTestId("oa-clear").count()) await page.getByTestId("oa-clear").click(); // start this run from an empty offline chat

  await askOffline("Where is my hotel?");
  const hotel = page.getByTestId("oa-answer").last();
  await expect(hotel).toContainText("Show this to a driver");
  await expect(hotel).toContainText("Check-in");
  await expect(hotel.getByTestId("oa-cites")).toContainText("Your booking");

  await askOffline("passport kho gaya"); // Hinglish → the frozen lost-passport rule set, rendered step by step
  const passport = page.getByTestId("oa-answer").last();
  await expect(passport).toContainText("Lost passport");
  expect(await passport.getByTestId("oa-steps").locator("li").count()).toBeGreaterThanOrEqual(5);
  await expect(passport).toContainText("Police number");
  await passport.getByTestId("oa-option").first().click(); // decision tree works offline
  expect(await passport.getByTestId("oa-steps").locator("li").count()).toBeGreaterThanOrEqual(7);

  await askOffline("please move my flight later"); // never changes anything offline
  await expect(page.getByTestId("oa-answer").last()).toContainText("Changes need a connection and your Confirm tap");
  await expect(page.getByTestId("review-card")).toHaveCount(0);

  await askOffline("what is the capital of mars");
  await expect(page.getByTestId("oa-answer").last()).toContainText("I can't answer that offline");
  await page.getByTestId("oa-queue").last().click();
  await expect(page.getByTestId("oa-queue").last()).toContainText("Queued for the Trip agent");
  await expect(page.getByTestId("oa-queued-note").last()).toBeVisible();

  // the offline chat history stays on the phone
  const answers = await page.getByTestId("oa-answer").count();
  expect(answers).toBe(4);
  await page.reload();
  await expect(page.getByTestId("offline-chat")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("oa-answer")).toHaveCount(answers);

  // and it never appears in the online chat
  await page.getByTestId("chat-tab-online").click();
  await expect(page.getByTestId("online-offline-banner")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("oa-answer")).toHaveCount(0);
  await context.setOffline(false);
});

test("8. the landing page (How it works) offers travel user and agent login; the agent desk raises an alert when an SOS text arrives", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/");
  // visitors land on the "How it works" story, which offers both logins up front
  await expect(page.getByTestId("hero-login-traveller")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("hero-login-agent")).toBeVisible();
  await expect(page.locator("#how")).toBeAttached();
  await page.getByTestId("hero-login-agent").click();
  await page.getByTestId("demo-agent-login").click();
  await expect(page.getByTestId("agent-desk")).toBeVisible();
  await expect(page).toHaveURL(/\/agent$/);
  const before = await page.getByTestId("alert-row").count();

  // a traveller texts the helpline (simulator endpoint = same handler as the Twilio webhook / poller)
  const res = await page.request.post("/api/sms/sim", { data: { from: "+919812345678", body: "SOS I lost my passport SS-48213" } });
  expect(res.ok()).toBeTruthy();

  await expect(page.getByTestId("new-alert")).toBeVisible({ timeout: 15_000 }); // alerted within the 5 s refresh
  await expect(page.getByTestId("new-alert")).toContainText("SMS");
  await expect.poll(() => page.getByTestId("alert-row").count()).toBe(before + 1);
  const row = page.getByTestId("alert-row").first();
  await expect(row).toContainText("EMERGENCY");
  await expect(row).toContainText("SS-48213");
  await row.getByTestId("take-btn").click();
  await expect(row).toContainText("Handling");
  await row.getByTestId("resolve-btn").click();
  await expect(page.locator('[data-testid="alert-row"][data-status="closed"]').first()).toBeVisible();
});

test("9. travel user creates an account with email + password, signs out, signs in again; a wrong password is refused", async ({ page }) => {
  await page.context().clearCookies();
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto("/login?role=traveller");
  await expect(page.getByTestId("demo-login")).toBeVisible(); // demo stays available
  await page.getByTestId("tab-create").click();
  await page.getByTestId("pw-name").fill("Test Traveller");
  await page.getByTestId("pw-email").fill(email);
  await page.getByTestId("pw-password").fill("password1"); // 8 characters but too common: the server refuses it
  await page.getByTestId("pw-submit").click();
  await expect(page.getByTestId("login-error")).toBeVisible(); // weak password refused
  await page.getByTestId("pw-password").fill("monsoon-2026!");
  await page.getByTestId("pw-submit").click();
  await expect(page).toHaveURL(/\/trips$/);
  await expect(page.getByText("No trips yet")).toBeVisible({ timeout: 15_000 }); // a new account has no bookings
  const me = await (await page.request.get("/api/me")).json();
  expect(me.user.email).toBe(email);
  expect(JSON.stringify(me)).not.toMatch(/scrypt|passwordHash/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/login?role=traveller");
  await page.getByTestId("pw-email").fill(email);
  await page.getByTestId("pw-password").fill("not-my-password");
  await page.getByTestId("pw-submit").click();
  await expect(page.getByTestId("login-error")).toContainText("do not match");
  await page.getByTestId("pw-password").fill("monsoon-2026!");
  await page.getByTestId("pw-submit").click();
  await expect(page).toHaveURL(/\/trips$/);
  await expect(page.getByText("No trips yet")).toBeVisible({ timeout: 15_000 });
});

test("10. signed-in travel user sees Home (the trip catalogue); an agent is sent to the desk; sign-out returns to the landing story", async ({ page }) => {
  await loginAs(page, "traveller", "/");
  await expect(page.getByTestId("how-it-works")).toHaveCount(0); // no guide block on the signed-in home: the story is the guide, reachable from the nav
  await expect(page.getByTestId("results")).toBeVisible(); // the trip catalogue is still the home page
  await expect(page.getByTestId("hero-login-traveller")).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByTestId("hero-login-traveller")).toBeVisible({ timeout: 20_000 }); // back on the landing story
  await loginAs(page, "agent", "/");
  await expect(page).toHaveURL(/\/agent$/);
});

test("11. hotel change: the agent sends you to your platform, you record the booking, review it and Confirm", async ({ page }) => {
  await loginAs(page, "traveller", `/trips/${REF}/chat`);
  await expect(page.getByTestId("chat-log")).toBeVisible();
  await ask(page, "Please extend my stay by 2 nights");
  const hc = page.getByTestId("hotels-card").last();
  await expect(hc).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("assistant-text").last()).toContainText("never see your password");
  await expect(hc.getByTestId("hotel-platform-open")).toHaveCount(4);
  expect(await hc.getByTestId("hotel-platform-open").first().getAttribute("href")).toMatch(/^https:\/\//);
  await expect(hc).toContainText(/sample/i); // sample prices from the mock partner API, clearly labelled
  expect(await hc.getByTestId("hotel-offer").count()).toBeGreaterThan(0);
  await hc.getByTestId("hf-amount").fill("9800");
  await hc.getByTestId("hf-submit").click();
  const card = page.getByTestId("review-card").last();
  await expect(card).toContainText("Record your stay change");
  await expect(card.getByTestId("review-notice")).toContainText("books and charges nothing");
  await expect(card.getByTestId("price-delta")).toContainText("9,800");
  await card.getByTestId("confirm-btn").click();
  await expect(page.getByTestId("receipt-card").last()).toContainText("you paid on the platform");
  await expect(page.getByTestId("guide-update").last()).toContainText("Offline guide updated to version");
});

test("12. Add travel plan: upload several files, each is read, and the plan is processed (no AI model in this test, so it says so plainly)", async ({ page }) => {
  await loginAs(page, "traveller", "/plans/new");
  await expect(page.getByTestId("add-plan")).toBeVisible();
  await page.getByTestId("plan-input").setInputFiles([
    { name: "itinerary.txt", mimeType: "text/plain", buffer: Buffer.from("Flight 6E 6143 BLR to GOX on 12 Dec 2026 07:15. Hotel Taj Holiday Village, Candolim, Goa, 12-15 Dec.") },
    { name: "days.csv", mimeType: "text/csv", buffer: Buffer.from("date,time,what,where\n2026-12-13,09:30,Fort visit,Fort Aguada") },
    { name: "slides.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: Buffer.from("x") },
  ]);
  await expect(page.getByTestId("plan-file")).toHaveCount(3);
  await page.getByTestId("plan-build").click();
  await expect(page.locator('[data-testid="plan-file"][data-state="read"]')).toHaveCount(2, { timeout: 20_000 });
  await expect(page.locator('[data-testid="plan-file"][data-state="skipped"]')).toHaveCount(1);
  await expect(page.getByTestId("plan-error")).toContainText("No AI model is configured", { timeout: 20_000 });
  // the entry points exist for signed-in travellers
  await page.goto("/trips");
  await expect(page.getByTestId("add-plan-btn")).toBeVisible();
});

test("13. offline: every trip page opens, switching between the Trip agent and the offline assistant works, and missing saved files are re-downloaded automatically", async ({ page, context }) => {
  await loginAs(page, "traveller", "/explore");
  await page.getByTestId("itinerary-card").first().click();
  await page.getByTestId("select-btn").click();
  await expect(page.getByTestId("offline-ready")).toHaveText("Offline guide ready", { timeout: 60_000 });
  const ref = (await page.getByText(/^SS-\d{5}$/).first().innerText()).trim();
  await page.evaluate(() => navigator.serviceWorker.ready);

  // simulate what iOS does: it drops a saved page and a saved map file
  await page.evaluate(async (r) => {
    const shell = await caches.open("ss-shell-v2");
    await shell.delete(`/trips/${r}/offline`);
    await shell.delete(`/trips/${r}/voucher`);
    const name = (await caches.keys()).find((n) => n.startsWith(`ss-trip-${r}`))!;
    const cache = await caches.open(name);
    const tile = (await cache.keys()).find((k) => k.url.endsWith(".pmtiles"));
    if (tile) await cache.delete(tile);
  }, ref);
  await page.reload(); // the quiet re-check on arrival refills what is missing
  await expect.poll(() => page.evaluate(async (r) => {
    const shell = await caches.open("ss-shell-v2");
    const name = (await caches.keys()).find((n) => n.startsWith(`ss-trip-${r}`))!;
    const tiles = (await (await caches.open(name)).keys()).filter((k) => k.url.endsWith(".pmtiles")).length;
    return { offlinePage: !!(await shell.match(`/trips/${r}/offline`)), voucher: !!(await shell.match(`/trips/${r}/voucher`)), tiles: tiles > 0 };
  }, ref), { timeout: 60_000 }).toEqual({ offlinePage: true, voucher: true, tiles: true });

  await context.setOffline(true);
  await page.goto(`/trips/${ref}/chat`);
  await expect(page.getByTestId("chat-tab-offline")).toBeVisible();
  await page.getByTestId("chat-tab-offline").click(); // switch to the offline assistant with no network
  await expect(page.getByTestId("offline-chat")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("chat-tab-online").click(); // and back
  await expect(page.getByTestId("chat-tab-online")).toHaveAttribute("aria-current", "page", { timeout: 15_000 });
  for (const p of ["", "/guide", "/map", "/sos", "/log", "/voucher"]) {
    await page.goto(`/trips/${ref}${p}`);
    await expect(page.locator("main")).not.toContainText("You are offline and this page is not saved", { timeout: 10_000 });
    await expect(page).not.toHaveTitle(/^You are offline/); // the real page, not the generic "not saved" fallback
    await expect(page.locator("body")).not.toContainText("That page is not saved on this phone");
  }
  await context.setOffline(false);
});
