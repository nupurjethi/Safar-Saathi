import { expect, test } from "@playwright/test";
import { REF, agentEvents, ask, askForCard, booking, loginAs } from "./helpers";

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

  // 7-8. agent: option list with price breakups, Yes on one
  await page.goto(`/trips/${ref}/chat`);
  const card = await askForCard(page, "Please move my flight later");
  await expect(card.getByTestId("breakup")).toBeVisible();
  expect(await card.getByTestId("breakup-line").count()).toBeGreaterThanOrEqual(2);
  await expect(card.getByTestId("offer-source")).toContainText("Sample data (mock API)");
  const flights = (await card.innerText()).match(/\b[A-Z]{2}\d{3}\b/g) ?? [];
  const newFlight = flights[1];
  expect(newFlight).toBeTruthy();
  await card.getByTestId("confirm-btn").click(); // "Yes, confirm"
  await expect(page.getByTestId("receipt-card")).toBeVisible();
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

test("3. move a flight → review card → Decline → booking unchanged", async ({ page }) => {
  await loginAs(page, "traveller", `/trips/${REF}/chat`);
  const before = await booking(page);
  const card = await askForCard(page, "Please move my Paris to Rome flight later");
  await expect(card.getByTestId("review-notice")).toHaveText("Nothing is booked until you tap Confirm.");
  await card.getByTestId("decline-btn").click();
  await expect(card).toHaveAttribute("data-state", "declined");
  const after = await booking(page);
  expect(after.booking.totalInr).toBe(before.booking.totalInr);
  expect(after.booking.packVersion).toBe(before.booking.packVersion);
  expect(after.items.length).toBe(before.items.length);
});

test("4. price move: 409 → new review card → Confirm → receipt → pack version +1", async ({ page }) => {
  await loginAs(page, "traveller", `/trips/${REF}/chat`);
  const before = await booking(page);
  await page.getByLabel(/Demo: move the price/).check();
  const first = await askForCard(page, "Please move my Paris to Rome flight later");
  const firstPrice = await first.getByTestId("price-delta").innerText();
  const firstQuote = await first.getAttribute("data-quote");
  await first.getByTestId("confirm-btn").click();
  await expect(page.getByText("The price moved from")).toBeVisible();
  await expect(page.locator(`[data-quote="${firstQuote}"]`)).toHaveAttribute("data-state", "repriced");
  const second = page.getByTestId("review-card").last();
  expect(await second.getByTestId("price-delta").innerText()).not.toBe(firstPrice);
  await second.getByTestId("confirm-btn").click();
  await expect(page.getByTestId("receipt-card")).toBeVisible();
  await expect(page.getByTestId("receipt-card")).toContainText("Offline guide updated");
  const after = await booking(page);
  expect(after.booking.packVersion).toBe(before.booking.packVersion + 1);
  expect(after.booking.totalInr).toBeGreaterThan(before.booking.totalInr);
});

test("5. apply without a token, and with a reused token, are both rejected", async ({ page }) => {
  await loginAs(page, "traveller", "/trips");
  const ev = await agentEvents(page, "Please move my Paris to Rome flight later");
  const card = ev.find((e) => e.t === "review")!.card!;
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

test("7. offline assistant: with no network the chat answers from the saved bundle (hotel, passport, change request), and falls back when the agent fails", async ({ page, context }) => {
  await loginAs(page, "traveller", `/trips/${REF}/chat`);
  await expect(page.getByTestId("chat-log")).toBeVisible(); // the bundle is on this phone once the chat renders
  await expect(page.getByTestId("offline-assistant")).toBeVisible();

  // (a) the online agent is unreachable → the question is answered from the saved bundle instead of an error
  await page.route("**/api/agent", (r) => r.abort());
  await ask(page, "when is my pickup");
  await expect(page.getByTestId("oa-answer").last()).toContainText("Pickup code", { timeout: 15_000 });
  await expect(page.getByTestId("oa-answer").last()).toContainText("rule-based, not AI");
  await page.unroute("**/api/agent");

  // (b) airplane mode
  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "You are offline" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("offline-assistant")).toHaveAttribute("aria-pressed", "true");

  await ask(page, "Where is my hotel?");
  const hotel = page.getByTestId("oa-answer").last();
  await expect(hotel).toContainText("Show this to a driver");
  await expect(hotel).toContainText("Check-in");
  await expect(hotel.getByTestId("oa-cites")).toContainText("Your booking");

  await ask(page, "passport kho gaya"); // Hinglish → the frozen lost-passport rule set, rendered step by step
  const passport = page.getByTestId("oa-answer").last();
  await expect(passport).toContainText("Lost passport");
  await expect(passport.getByTestId("oa-steps").locator("li").first()).toBeVisible();
  expect(await passport.getByTestId("oa-steps").locator("li").count()).toBeGreaterThanOrEqual(5);
  await expect(passport).toContainText("Police number");
  await passport.getByTestId("oa-option").first().click(); // decision tree works offline
  expect(await passport.getByTestId("oa-steps").locator("li").count()).toBeGreaterThanOrEqual(7);

  const cardsBefore = await page.getByTestId("review-card").count(); // older cards restored from chat history are fine
  await ask(page, "please move my flight later"); // never changes anything offline
  await expect(page.getByTestId("oa-answer").last()).toContainText("Changes need a connection and your Confirm tap");
  await expect(page.getByTestId("review-card")).toHaveCount(cardsBefore); // no new review card, nothing changed

  await ask(page, "what is the capital of mars");
  await expect(page.getByTestId("oa-answer").last()).toContainText("I can't answer that offline");
  await page.getByTestId("oa-queue").last().click();
  await expect(page.getByTestId("oa-queue").last()).toContainText("Queued for the Trip agent");

  await page.getByTestId("oa-chip").first().click(); // suggested questions are answered too
  await expect.poll(async () => page.getByTestId("oa-answer").count()).toBeGreaterThanOrEqual(6);
  await context.setOffline(false);
});

test("8. first page offers travel user and agent login; the agent desk raises an alert when an SOS text arrives", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/");
  await expect(page.getByTestId("role-login")).toBeVisible();
  await expect(page.getByTestId("login-traveller")).toBeVisible();
  await page.getByTestId("login-agent").click();
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
