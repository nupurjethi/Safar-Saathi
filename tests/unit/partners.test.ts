import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import {
  DEFAULT_MARKUPS, SAMPLE_SOURCE, areaKey, ensurePartnerMarkups, generateMockFlights, generateMockHotels, mockFlightOffers, mockHotelOffers, platformPrice, platformPricesFor,
} from "@/lib/providers/partners";
import { compareFlightsOrSample } from "@/lib/providers/compare";
import type { FlightProvider, Offer } from "@/lib/providers/types";
import { addDays } from "@/lib/time";
import { BASE_DATE, setupDb } from "./helpers";

beforeAll(async () => { await setupDb(); });

describe("mock partner API: per-platform pricing", () => {
  it("price = base x (1 + markup) x (1 - discount) + fee", () => {
    expect(platformPrice(10000, { markupBps: 350, discountBps: 0, feeInr: 299 })).toBe(10649);
    expect(platformPrice(10000, { markupBps: 300, discountBps: 100, feeInr: 249 })).toBe(10446); // 10300 x 0.99 + 249
    expect(platformPrice(0, { markupBps: 500, discountBps: 0, feeInr: 199 })).toBe(199);
    const list = platformPricesFor(10000, DEFAULT_MARKUPS.filter((m) => m.kind === "flight"), (p) => `https://x/${p}`);
    expect(list.map((p) => p.platform).sort()).toEqual(["cleartrip", "goibibo", "ixigo", "makemytrip"]);
    expect(list.map((p) => p.totalInr)).toEqual([...list.map((p) => p.totalInr)].sort((a, b) => a - b)); // cheapest first
  });
  it("markups are seeded with the catalogue and ensurePartnerMarkups is idempotent", async () => {
    const db = await getDb();
    expect((await db.select().from(s.partnerMarkups)).length).toBe(8);
    expect(await ensurePartnerMarkups(db)).toBe(0);
    expect((await db.select().from(s.partnerMarkups)).length).toBe(8);
  });
});

describe("mock partner API: flights stored in the database", () => {
  it("generation is deterministic per route and day", () => {
    const a = generateMockFlights({ from: "GOI", to: "JAI", date: "2026-12-01", fromTz: "Asia/Kolkata" });
    const b = generateMockFlights({ from: "GOI", to: "JAI", date: "2026-12-01", fromTz: "Asia/Kolkata" });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(5);
    expect(a.length).toBeLessThanOrEqual(6);
    expect(generateMockFlights({ from: "GOI", to: "JAI", date: "2026-12-02", fromTz: "Asia/Kolkata" })).not.toEqual(a);
  });
  it("an unknown route is generated once, stored, then read back (same flights)", async () => {
    const db = await getDb();
    const q = { from: "GOI", to: "JAI", date: addDays(BASE_DATE, 10), pax: 2, fromTz: "Asia/Kolkata" };
    const first = await mockFlightOffers(q, db);
    expect(first.generated).toBe(true);
    const stored = await db.select().from(s.flights).where(and(eq(s.flights.fromIata, "GOI"), eq(s.flights.toIata, "JAI")));
    expect(stored.length).toBe(first.offers.length);
    const second = await mockFlightOffers(q, db);
    expect(second.generated).toBe(false);
    expect(second.offers.map((o) => o.id)).toEqual(first.offers.map((o) => o.id));
    for (const o of second.offers) {
      expect(o.source).toBe(SAMPLE_SOURCE);
      expect(o.totalInr).toBe(o.perTravellerInr * 2);
      expect(o.facts.departLocal.slice(0, 10)).toBe(q.date);
      expect(o.platformPrices.length).toBe(4);
      for (const p of o.platformPrices) { expect(p.totalInr).toBeGreaterThan(o.totalInr * 0.9); expect(p.url).toMatch(/^https:\/\/www\./); expect(p.url).toContain("GOI"); }
    }
  });
  it("a seeded route reads the existing catalogue flights (nothing generated)", async () => {
    const db = await getDb();
    const [f] = await db.select().from(s.flights).where(eq(s.flights.fromIata, "PNQ")).limit(1);
    const date = new Date(f.departAt.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10); // origin is in India
    const r = await mockFlightOffers({ from: f.fromIata, to: f.toIata, date, pax: 1, fromTz: "Asia/Kolkata" }, db);
    expect(r.generated).toBe(false);
    expect(r.offers.some((o) => o.id === `mock:${f.id}`)).toBe(true);
  });
  it("compareFlightsOrSample uses the mock partner API without keys, and a live provider when one is enabled", async () => {
    const q = { from: "GOI", to: "JAI", date: addDays(BASE_DATE, 10), pax: 2, fromTz: "Asia/Kolkata" };
    const sample = await compareFlightsOrSample(q);
    expect(sample.sample).toBe(true);
    expect(sample.offers[0].platformPrices?.length).toBe(4);
    expect(sample.offers.map((o) => o.totalInr)).toEqual([...sample.offers.map((o) => o.totalInr)].sort((a, b) => a - b));
    const liveOffer: Offer = { id: "L1", provider: "duffel", kind: "flight", source: "Live price from Duffel", validUntil: "", breakup: [{ label: "Fare", amountInr: 9000 }], totalInr: 9000, refundable: false, summary: "", payload: {}, facts: { carrier: "X", flightNo: "X1", from: "GOI", to: "JAI", departLocal: "", arriveLocal: "", stops: 0 } };
    const live: FlightProvider = { name: "duffel", enabled: () => true, search: async () => [liveOffer], quote: async () => liveOffer, book: async () => ({ reference: "" }) };
    const r = await compareFlightsOrSample(q, { list: [live] });
    expect(r.sample).toBe(false);
    expect(r.offers.map((o) => o.id)).toEqual(["L1"]);
  });
});

describe("mock partner API: hotels", () => {
  it("a seeded city uses the catalogue hotels and their room inventory", async () => {
    const db = await getDb();
    const [paris] = await db.select().from(s.destinations).where(eq(s.destinations.slug, "paris"));
    const checkin = addDays(BASE_DATE, 3);
    const r = await mockHotelOffers({ lat: paris.centerLat, lon: paris.centerLon, cityName: "Paris", citySlug: "paris", checkin, checkout: addDays(checkin, 2), rooms: 1, adults: 2 }, db);
    expect(r.generated).toBe(false);
    const hotels = await db.select().from(s.hotels).where(eq(s.hotels.destinationId, paris.id));
    for (const o of r.offers) expect(hotels.some((h) => o.id.startsWith(`mock:${h.id}`))).toBe(true);
    expect(r.offers.every((o) => o.platformPrices.length === 4 && o.source === SAMPLE_SOURCE)).toBe(true);
  });
  it("an unknown place gets 5 deterministic hotels stored once in mock_hotels", async () => {
    const db = await getDb();
    const where = { lat: 15.4909, lon: 73.8278, cityName: "Panaji" };
    expect(generateMockHotels(where.lat, where.lon, where.cityName)).toEqual(generateMockHotels(where.lat, where.lon, where.cityName));
    const checkin = addDays(BASE_DATE, 5);
    const q = { ...where, checkin, checkout: addDays(checkin, 3), rooms: 2, adults: 3 };
    const first = await mockHotelOffers(q, db);
    expect(first.generated).toBe(true);
    expect((await db.select().from(s.mockHotels).where(eq(s.mockHotels.areaKey, areaKey(where.lat, where.lon)))).length).toBe(5);
    const second = await mockHotelOffers(q, db);
    expect(second.generated).toBe(false);
    expect(second.offers.map((o) => o.id)).toEqual(first.offers.map((o) => o.id));
    for (const o of second.offers) {
      expect(o.perNightInr).toBe(Math.round(o.totalInr / 3 / 2));
      expect(o.lat).toBeCloseTo(where.lat, 1);
      expect(o.platformPrices.map((p) => p.platform).sort()).toEqual(["cleartrip", "goibibo", "ixigo", "makemytrip"]);
      for (const p of o.platformPrices) expect(p.url).toMatch(/^https:\/\/www\..*hotels/);
    }
  });
});
