import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mapAmadeus, AmadeusFlightProvider } from "@/lib/providers/amadeus";
import { compareFlights, realProviders } from "@/lib/providers/compare";
import { runTool, type ToolCtx, type UiEvent } from "@/lib/agent/tools";
import type { FlightProvider, Offer } from "@/lib/providers/types";
import { setupDb } from "./helpers";

const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const amadeusBody = {
  data: [
    { id: "1", price: { currency: "INR", total: "15200.00", base: "12000.00" }, itineraries: [{ duration: "PT2H15M", segments: [{ carrierCode: "AF", number: "1104", departure: { iataCode: "CDG", at: "2026-11-20T10:05:00" }, arrival: { iataCode: "FCO", at: "2026-11-20T12:20:00" } }] }] },
    { id: "2", price: { currency: "INR", total: "11800.00", base: "9000.00" }, itineraries: [{ duration: "PT5H40M", segments: [{ carrierCode: "LH", number: "2200", departure: { iataCode: "CDG", at: "2026-11-20T07:00:00" }, arrival: { iataCode: "FRA", at: "2026-11-20T08:30:00" } }, { carrierCode: "LH", number: "232", departure: { iataCode: "FRA", at: "2026-11-20T10:00:00" }, arrival: { iataCode: "FCO", at: "2026-11-20T12:40:00" } }] }] },
  ],
  dictionaries: { carriers: { AF: "AIR FRANCE", LH: "LUFTHANSA" } },
};
const fake = (name: FlightProvider["name"], offers: Offer[] | Error, enabled = true): FlightProvider => ({
  name, enabled: () => enabled,
  search: async () => { if (offers instanceof Error) throw offers; return offers; },
  quote: async () => { throw new Error("x"); }, book: async () => { throw new Error("x"); },
});
const offer = (id: string, total: number, stops = 0, dur = 130): Offer => ({ id, provider: "duffel", kind: "flight", source: "Live price from Duffel", validUntil: new Date(Date.now() + 600000).toISOString(), breakup: [{ label: "Fare", amountInr: total }], totalInr: total, refundable: false, summary: "x", payload: {}, facts: { carrier: "Test Air", flightNo: `TA${id}`, from: "CDG", to: "FCO", departLocal: "2026-11-20T10:00", arriveLocal: "2026-11-20T12:10", stops, durationMin: dur } });

afterEach(() => { vi.unstubAllGlobals(); delete process.env.AMADEUS_API_KEY; delete process.env.AMADEUS_API_SECRET; delete process.env.AMADEUS_ENV; });

describe("Amadeus adapter (official API, mocked here)", () => {
  it("maps real-shaped offers: totals add up, carrier names, stops, local times", () => {
    const [a, b] = mapAmadeus(amadeusBody, 1, 2);
    expect(a.facts).toMatchObject({ carrier: "Air France", flightNo: "AF1104", from: "CDG", to: "FCO", departLocal: "2026-11-20T10:05", arriveLocal: "2026-11-20T12:20", stops: 0, durationMin: 135 });
    expect(a.breakup.reduce((s, l) => s + l.amountInr, 0)).toBe(a.totalInr);
    expect(a.totalInr).toBe(15200);
    expect(b.facts!.stops).toBe(1);
    expect(a.source).toMatch(/Live price from Amadeus/);
  });
  it("is off without keys; with keys it signs in, then searches INR fares for the right route and party", async () => {
    expect(AmadeusFlightProvider.enabled()).toBe(false);
    process.env.AMADEUS_API_KEY = "k"; process.env.AMADEUS_API_SECRET = "s";
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(String(url)); return String(url).includes("oauth2/token") ? ok({ access_token: "tok", expires_in: 1799 }) : ok(amadeusBody); }));
    const offers = await AmadeusFlightProvider.search({ from: "CDG", to: "FCO", date: "2026-11-20", pax: 2 });
    expect(offers.length).toBe(2);
    expect(calls[0]).toContain("test.api.amadeus.com/v1/security/oauth2/token");
    expect(calls[1]).toMatch(/originLocationCode=CDG.*destinationLocationCode=FCO.*departureDate=2026-11-20.*adults=2.*currencyCode=INR/);
  });
});

describe("compareFlights", () => {
  it("is not configured with no real price source (sample fares are never mixed in)", async () => {
    expect(realProviders()).toEqual([]);
    expect(await compareFlights({ from: "CDG", to: "FCO", date: "2026-11-20", pax: 2 })).toMatchObject({ configured: false, offers: [] });
  });
  it("merges providers, ranks cheapest first, marks fastest, and one provider failing does not hide the others", async () => {
    const res = await compareFlights({ from: "CDG", to: "FCO", date: "2026-11-20", pax: 2 }, [fake("amadeus", [offer("1", 15000, 0, 135), offer("2", 11000, 1, 340)]), fake("duffel", new Error("Duffel 500"))]);
    expect(res.configured).toBe(true);
    expect(res.offers.map((o) => o.totalInr)).toEqual([11000, 15000]);
    expect(res.cheapestId).toBe("2");
    expect(res.fastestId).toBe("1");
    expect(res.offers[0].perTravellerInr).toBe(5500);
    expect(res.providers).toEqual([{ name: "Amadeus", ok: true, count: 2, error: undefined }, { name: "Duffel", ok: false, count: 0, error: "Duffel 500" }]);
  });
});

describe("compare_flights agent tool", () => {
  let c: Awaited<ReturnType<typeof setupDb>>;
  const events: UiEvent[] = [];
  const mk = (): ToolCtx => ({ userId: c.neha.id, bookingRef: c.booking.ref, bookingId: c.booking.id, threadId: null, channel: "app", now: new Date(), ui: (e) => events.push(e) });
  beforeAll(async () => { c = await setupDb(); });

  it("with no price source it says so and shows the platform picker instead (never invents a price)", async () => {
    events.length = 0;
    const out = (await runTool("compare_flights", {}, mk())) as { configured: boolean; next: string };
    expect(out.configured).toBe(false);
    expect(out.next).toMatch(/CANNOT compare prices/);
    expect(events.some((e) => e.t === "compare")).toBe(false);
    const pf = events.find((e) => e.t === "platforms") as Extract<UiEvent, { t: "platforms" }>;
    expect(pf.platforms.map((p) => p.name)).toEqual(["MakeMyTrip", "Goibibo", "Cleartrip", "ixigo"]);
  });

  it("with a configured price API it shows a comparison with pre-filled links for all four platforms", async () => {
    process.env.AMADEUS_API_KEY = "k"; process.env.AMADEUS_API_SECRET = "s";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("oauth2/token") ? ok({ access_token: "tok", expires_in: 1799 }) : ok(amadeusBody))));
    events.length = 0;
    const out = (await runTool("compare_flights", {}, mk())) as { configured: boolean; offers: { totalInr: number }[]; cheapest: string };
    expect(out.configured).toBe(true);
    expect(out.offers.map((o) => o.totalInr)).toEqual([11800, 15200]);
    const cmp = events.find((e) => e.t === "compare") as Extract<UiEvent, { t: "compare" }>;
    expect(cmp.offers.length).toBe(2);
    expect(cmp.cheapestId).toBe("amadeus:2");
    expect(cmp.platforms.map((p) => p.id)).toEqual(["makemytrip", "goibibo", "cleartrip", "ixigo"]);
    for (const p of cmp.platforms) expect(p.searchUrl).toContain(cmp.query.from);
  });
});
