import { describe, expect, it } from "vitest";
import { flightProviders, stayProviders } from "@/lib/providers";
import { MockFlightProvider } from "@/lib/providers/mock";
import { DuffelFlightProvider } from "@/lib/providers/duffel";
import { assertBreakup } from "@/lib/providers/types";
import { setupDb } from "./helpers";
import { addDays } from "@/lib/time";

describe("provider adapters (spec 6.3)", () => {
  it("the mock is on by default and real providers need a key", () => {
    delete process.env.DUFFEL_API_KEY;
    expect(flightProviders().map((p) => p.name)).toEqual(["mock"]);
    expect(stayProviders().map((p) => p.name)).toEqual(["mock"]);
    expect(DuffelFlightProvider.enabled()).toBe(false);
    process.env.DUFFEL_API_KEY = "x";
    expect(flightProviders().map((p) => p.name)).toEqual(["mock", "duffel"]);
    delete process.env.DUFFEL_API_KEY;
  });

  it("a live provider can search but cannot book (booking is not wired)", async () => {
    await expect(DuffelFlightProvider.book("x")).rejects.toThrow(/STUB/);
  });

  it("mock offers carry source, validity and a breakup that adds up", async () => {
    await setupDb();
    const { getDb } = await import("@/lib/db/client");
    const db = await getDb();
    const { flights } = await import("@/lib/db/schema");
    const [f] = await db.select().from(flights).limit(1);
    const day = new Date(f.departAt).toISOString().slice(0, 10);
    let offers: Awaited<ReturnType<typeof MockFlightProvider.search>> = [];
    for (const d of [day, addDays(day, 1), addDays(day, -1)]) { offers = await MockFlightProvider.search({ from: f.fromIata, to: f.toIata, date: d, pax: 2 }); if (offers.length) break; }
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) {
      expect(o.source).toBe("Sample data (mock API)");
      expect(new Date(o.validUntil).getTime()).toBeGreaterThan(Date.now());
      expect(() => assertBreakup(o.breakup, o.totalInr)).not.toThrow();
    }
  });
});
