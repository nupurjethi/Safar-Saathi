import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { applyChange, createQuote, issueConfirmation } from "@/lib/gate/changes";
import { GateError } from "@/lib/gate/errors";
import { getLatestPack } from "@/lib/packs/build";
import type { OfflinePack } from "@/lib/packs/types";
import { compareHotels, mapAmadeusHotels, type HotelOffer } from "@/lib/providers/hotels";
import { hotelLinks } from "@/lib/providers/platforms";
import { runTool, type ToolCtx, type UiEvent } from "@/lib/agent/tools";
import { addDays } from "@/lib/time";
import { setupDb } from "./helpers";

let c: Awaited<ReturnType<typeof setupDb>>;
beforeAll(async () => { c = await setupDb(); });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.AMADEUS_API_KEY; delete process.env.AMADEUS_API_SECRET; });

async function lastHotel() {
  const db = await getDb();
  const rows = await db.select().from(s.bookingItems).where(and(eq(s.bookingItems.bookingId, c.booking.id), eq(s.bookingItems.kind, "hotel"), eq(s.bookingItems.status, "confirmed")));
  return rows.sort((a, b) => String(a.details.checkinDate).localeCompare(String(b.details.checkinDate))).at(-1)!;
}
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });

describe("hotel price source (Amadeus, official API, mocked)", () => {
  it("maps offers: totals add up, per-night, refundable, cancellation text", () => {
    const [o] = mapAmadeusHotels({ data: [{ hotel: { hotelId: "H1", name: "GRAND PLAZA", latitude: 48.86, longitude: 2.33, address: { lines: ["1 Rue X"] } }, offers: [{ id: "OF1", checkInDate: "2026-11-20", checkOutDate: "2026-11-22", room: { typeEstimated: { category: "STANDARD_ROOM", beds: 1, bedType: "QUEEN" } }, price: { currency: "INR", base: "16000.00", total: "18000.00" }, policies: { cancellations: [{ deadline: "2026-11-18T00:00:00", amount: "0.00" }] } }] }] }, { rooms: 2 });
    expect(o.hotelName).toBe("Grand Plaza");
    expect(o.totalInr).toBe(18000);
    expect(o.breakup.reduce((a, l) => a + l.amountInr, 0)).toBe(18000);
    expect(o.perNightInr).toBe(4500); // 18000 / 2 nights / 2 rooms
    expect(o.refundable).toBe(true);
    expect(o.cancellation).toMatch(/Free cancellation until 2026-11-18/);
    expect(o.lat).toBe(48.86);
  });
  it("not configured without keys; ranks cheapest first; a failing source returns an honest error, not sample prices", async () => {
    expect(await compareHotels({ lat: 1, lon: 1, checkin: "2026-11-20", checkout: "2026-11-21", rooms: 1, adults: 2 })).toMatchObject({ configured: false, offers: [] });
    const mk = (id: string, total: number): HotelOffer => ({ id, provider: "amadeus", providerLabel: "Amadeus", source: "Live", hotelName: id, totalInr: total, perNightInr: total, breakup: [{ label: "x", amountInr: total }], refundable: false, validUntil: "" });
    const res = await compareHotels({ lat: 1, lon: 1, checkin: "a", checkout: "b", rooms: 1, adults: 1 }, async () => [mk("B", 9000), mk("A", 7000)], () => true);
    expect(res.offers.map((o) => o.id)).toEqual(["A", "B"]);
    expect(res.cheapestId).toBe("A");
    const bad = await compareHotels({ lat: 1, lon: 1, checkin: "a", checkout: "b", rooms: 1, adults: 1 }, async () => { throw new Error("Amadeus 500"); }, () => true);
    expect(bad).toMatchObject({ configured: true, offers: [] });
    expect(bad.providers[0].error).toBe("Amadeus 500");
  });
  it("links open each platform's hotel page", () => {
    expect(hotelLinks().map((l) => l.name)).toEqual(["MakeMyTrip", "Goibibo", "Cleartrip", "ixigo"]);
    for (const l of hotelLinks()) expect(l.hotelsUrl).toMatch(/^https:\/\/www\..*hotels/);
  });
});

describe("compare_hotels agent tool", () => {
  const events: UiEvent[] = [];
  const mk = (): ToolCtx => ({ userId: c.neha.id, bookingRef: c.booking.ref, bookingId: c.booking.id, threadId: null, channel: "app", now: new Date(), ui: (e) => events.push(e) });
  it("with no price source: says so, shows the details to enter, never prices", async () => {
    events.length = 0;
    const out = (await runTool("compare_hotels", { extraNights: 2 }, mk())) as { configured: boolean; next: string };
    expect(out.configured).toBe(false);
    expect(out.next).toMatch(/CANNOT compare prices/);
    const h = events.find((e) => e.t === "hotels") as Extract<UiEvent, { t: "hotels" }>;
    expect(h.query.nights).toBe(2);
    expect(h.query.checkin).toBe(h.current.checkout);
    expect(h.query.checkout).toBe(addDays(h.current.checkout, 2));
    expect(h.offers).toEqual([]);
  });
  it("with a configured price source it shows ranked live offers for the dates after check-out", async () => {
    process.env.AMADEUS_API_KEY = "k"; process.env.AMADEUS_API_SECRET = "s";
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      seen.push(String(url));
      if (String(url).includes("oauth2/token")) return ok({ access_token: "t", expires_in: 1799 });
      if (String(url).includes("by-geocode")) return ok({ data: [{ hotelId: "H1" }, { hotelId: "H2" }] });
      return ok({ data: [
        { hotel: { hotelId: "H1", name: "PRICEY", latitude: 1, longitude: 1 }, offers: [{ id: "O1", checkInDate: "2026-11-20", checkOutDate: "2026-11-21", price: { currency: "INR", base: "9000", total: "10000" } }] },
        { hotel: { hotelId: "H2", name: "CHEAP", latitude: 1, longitude: 1 }, offers: [{ id: "O2", checkInDate: "2026-11-20", checkOutDate: "2026-11-21", price: { currency: "INR", base: "5000", total: "5600" } }] },
      ] });
    }));
    events.length = 0;
    await runTool("compare_hotels", { extraNights: 1 }, mk());
    const h = events.find((e) => e.t === "hotels") as Extract<UiEvent, { t: "hotels" }>;
    expect(h.configured).toBe(true);
    expect(h.offers.map((o) => o.hotelName)).toEqual(["Cheap", "Pricey"]);
    expect(h.cheapestId).toBe("amadeus:O2");
    expect(seen.some((u) => u.includes("hotelIds=H1%2CH2") && u.includes("currency=INR"))).toBe(true);
  });
});

describe("recording a hotel stay booked on a platform goes through the Confirm gate", () => {
  it("extend: needs the token; then moves check-out, the trip end and the guide; recorded as an external payment, not a charge", async () => {
    const h = await lastHotel();
    const d = h.details as Record<string, string | number>;
    const newCheckout = addDays(String(d.checkoutDate), 2);
    const params = { mode: "extend", platform: "goibibo", itemId: h.id, newCheckoutDate: newCheckout, amountPaidInr: 9800, confirmationCode: "gb12 345" };
    const card = await createQuote({ bookingRef: c.booking.ref, userId: c.neha.id, kind: "hotel_external", params });
    expect(card.title).toBe("Record your stay change");
    expect(card.source).toMatch(/Entered by you from Goibibo/);
    expect(card.after.lines.find((l) => l.label === "Confirmation code")!.value).toBe("GB12345");
    expect(card.totalInr).toBe(9800);
    expect(card.rules.join(" ")).toMatch(/does NOT move your return flight/);
    expect((await lastHotel()).details.checkoutDate).toBe(d.checkoutDate); // nothing changed yet
    await expect(applyChange({ quoteId: card.quoteId, token: null, userId: c.neha.id })).rejects.toMatchObject({ code: "NO_TOKEN" });
    const db = await getDb();
    const [b0] = await db.select().from(s.bookings).where(eq(s.bookings.id, c.booking.id));
    const { token } = await issueConfirmation({ quoteId: card.quoteId, userId: c.neha.id });
    const receipt = await applyChange({ quoteId: card.quoteId, token, userId: c.neha.id });
    expect(receipt.kind).toBe("hotel_external");
    expect(receipt.newTotalInr).toBe(b0.totalInr + 9800);
    const now = await lastHotel();
    expect(now.details.checkoutDate).toBe(newCheckout);
    expect(Number(now.details.nights)).toBe(Number(d.nights) + 2);
    expect(now.details.externalPlatform).toBe("goibibo");
    const [b1] = await db.select().from(s.bookings).where(eq(s.bookings.id, c.booking.id));
    expect(b1.endDate >= newCheckout).toBe(true);
    const pay = await db.select().from(s.payments).where(and(eq(s.payments.bookingId, c.booking.id), eq(s.payments.method, "external"), eq(s.payments.amountInr, 9800)));
    expect(pay[0]?.status).toBe("recorded");
    const pack = (await getLatestPack(c.booking.id))!.pack as OfflinePack;
    expect(pack.stays.at(-1)!.to).toBe(newCheckout);
    await expect(applyChange({ quoteId: card.quoteId, token, userId: c.neha.id })).rejects.toBeInstanceOf(GateError);
  });

  it("replace: swaps in the hotel you chose (with its location) and refuses a hotel in another city", async () => {
    const h = await lastHotel();
    const d = h.details as Record<string, string | number>;
    const base = { mode: "replace", platform: "cleartrip", itemId: h.id, hotelName: "Chosen Hotel", address: "5 Test Street", lat: Number(d.lat) + 0.01, lon: Number(d.lon) + 0.01, checkinDate: String(d.checkinDate), checkoutDate: String(d.checkoutDate), rooms: Number(d.rooms), amountPaidInr: 12000 };
    for (const bad of [{ lat: 10 }, { hotelName: "" }, { checkoutDate: String(d.checkinDate) }, { rooms: 0 }, { platform: "skyscanner" }, { amountPaidInr: -1 }, { phone: "call me" }]) {
      await expect(createQuote({ bookingRef: c.booking.ref, userId: c.neha.id, kind: "hotel_external", params: { ...base, ...bad } }), JSON.stringify(bad)).rejects.toBeInstanceOf(GateError);
    }
    const card = await createQuote({ bookingRef: c.booking.ref, userId: c.neha.id, kind: "hotel_external", params: base });
    const { token } = await issueConfirmation({ quoteId: card.quoteId, userId: c.neha.id });
    const rcpt = await applyChange({ quoteId: card.quoteId, token, userId: c.neha.id });
    expect(rcpt.guide.updated).toBe(true); // the offline guide really refreshed (it needs a hotel phone: a placeholder is stored when none is entered)
    const now = await lastHotel();
    expect(now.details.name).toBe("Chosen Hotel");
    expect(now.details.lat).toBeCloseTo(Number(d.lat) + 0.01, 5);
    const pack = (await getLatestPack(c.booking.id))!.pack as OfflinePack;
    expect(Object.values(pack.places).some((p) => p.kind === "hotel" && p.name === "Chosen Hotel")).toBe(true);
  });

  it("another user cannot record a stay change on this booking", async () => {
    const h = await lastHotel();
    await expect(createQuote({ bookingRef: c.booking.ref, userId: "00000000-0000-4000-8000-000000000000", kind: "hotel_external", params: { mode: "extend", platform: "ixigo", itemId: h.id, newCheckoutDate: addDays(String(h.details.checkoutDate), 1), amountPaidInr: 1 } })).rejects.toBeInstanceOf(GateError);
  });
});
