import { describe, expect, it } from "vitest";
import { generateSeed } from "@/lib/seed/generate";
import { DESTINATIONS } from "@/lib/seed/data";

const OPTS = { baseDate: "2026-11-10", flightDays: 6 };

describe("seed generator", () => {
  const a = generateSeed(OPTS);
  const b = generateSeed(OPTS);

  it("is deterministic: same seed, same data", () => {
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = generateSeed({ ...OPTS, seed: 7 });
    expect(JSON.stringify(c.itineraries.map((i) => i.id))).not.toBe(JSON.stringify(a.itineraries.map((i) => i.id)));
  });

  it("has 26 destinations and 100 to 125 itineraries with unique slugs", () => {
    expect(a.destinations.length).toBe(26);
    expect(DESTINATIONS.length).toBe(26);
    expect(a.itineraries.length).toBeGreaterThanOrEqual(100);
    expect(a.itineraries.length).toBeLessThanOrEqual(125);
    expect(new Set(a.itineraries.map((i) => i.slug)).size).toBe(a.itineraries.length);
  });

  it("covers every theme and tier, nights 3 to 8 (the two Bangalore demo trips are 3 nights), and includes the Paris to Rome demo trip", () => {
    expect(new Set(a.itineraries.map((i) => i.theme))).toEqual(new Set(["beach", "culture", "adventure", "family", "honeymoon"]));
    expect(new Set(a.itineraries.map((i) => i.tier))).toEqual(new Set(["budget", "standard", "premium"]));
    expect(Math.min(...a.itineraries.map((i) => i.nights))).toBeGreaterThanOrEqual(3);
    expect(Math.max(...a.itineraries.map((i) => i.nights))).toBeLessThanOrEqual(8);
    const demo = a.itineraries.find((i) => i.slug === "paris-rome-classic-7n")!;
    expect(demo.cities).toEqual(["paris", "rome"]);
  });

  it("has two domestic Bangalore trips from DEL and BOM with real landmarks and flights both ways", () => {
    const blr = a.itineraries.filter((i) => i.cities[0] === "bangalore");
    expect(blr.map((i) => i.slug).sort()).toEqual(["bangalore-3n-budget-family", "bangalore-3n-standard-culture"]);
    expect(blr.every((i) => i.nights === 3 && i.originCity !== "BLR")).toBe(true);
    const d = a.destinations.find((x) => x.slug === "bangalore")!;
    expect(d.currency).toBe("INR");
    expect(a.pois.filter((p) => p.destinationId === d.id && p.category === "sight").length).toBeGreaterThanOrEqual(8);
    for (const i of blr) {
      expect(a.flights.some((f) => f.fromIata === i.originCity && f.toIata === "BLR")).toBe(true);
      expect(a.flights.some((f) => f.fromIata === "BLR" && f.toIata === i.originCity)).toBe(true);
    }
    const fares = a.flights.filter((f) => f.toIata === "BLR" && ["DEL", "BOM"].includes(f.fromIata)).map((f) => f.fareInr);
    expect(Math.min(...fares)).toBeGreaterThan(2000);
    expect(Math.max(...fares)).toBeLessThan(25000);
  });

  it("gives every itinerary nights + 1 days", () => {
    for (const it of a.itineraries) expect(a.itineraryDays.filter((d) => d.itineraryId === it.id).length).toBe(it.nights + 1);
  });

  it("uses only fictional carriers, placeholder phones and marks contacts as sample", () => {
    expect(new Set(a.flights.map((f) => f.carrierName)).size).toBeLessThanOrEqual(5);
    expect(a.hotels.every((h) => h.phoneSample === "+00 000 000 0000")).toBe(true);
    expect(a.transfers.every((t) => t.driverPhoneSample === "+00 000 000 0000")).toBe(true);
    expect(a.destinations.every((d) => d.consulate.sample === true)).toBe(true);
  });

  it("generates 3 to 5 flights per route per day plus room inventory", () => {
    const one = a.flights.filter((f) => f.fromIata === a.flights[0].fromIata && f.toIata === a.flights[0].toIata);
    expect(one.length).toBeGreaterThanOrEqual(3 * 16);
    expect(a.roomInventory.length).toBeGreaterThan(a.hotels.length * 16 * 2 - 1);
  });
});
