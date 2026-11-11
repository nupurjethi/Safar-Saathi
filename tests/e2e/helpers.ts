import { expect, type Page } from "@playwright/test";

export const REF = "SS-48213";

export async function loginAs(page: Page, role: "traveller" | "agent" | "admin", next = "/trips") {
  await page.goto(`/api/auth/demo?role=${role}&next=${encodeURIComponent(next)}`);
}

export async function ask(page: Page, text: string) {
  const input = page.locator("#chat-input");
  await input.fill(text);
  await input.press("Enter");
}

export async function booking(page: Page, ref = REF) {
  const r = await page.request.get(`/api/mock/v1/bookings/${ref}`);
  expect(r.ok()).toBeTruthy();
  return (await r.json()) as { booking: { totalInr: number; packVersion: number; endDate: string }; items: { id: string; kind: string; status: string }[] };
}

/** Reads the NDJSON agent stream and returns the events. */
export async function agentEvents(page: Page, message: string) {
  const res = await page.request.post("/api/agent", { data: { bookingRef: REF, message } });
  expect(res.ok()).toBeTruthy();
  return (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l)) as { t: string; card?: { quoteId: string; priceDeltaInr: number } }[];
}

/** Ask something that should produce a NEW review card (history may already hold older cards). */
export async function askForCard(page: Page, text: string) {
  const cards = page.getByTestId("review-card");
  const n = await cards.count();
  await ask(page, text);
  await expect.poll(async () => cards.count(), { timeout: 20_000 }).toBeGreaterThan(n);
  await page.waitForTimeout(700); // the agent sends the options one after another
  return cards.nth(n); // the first of the new options
}
