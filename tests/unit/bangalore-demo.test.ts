import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { createBangaloreDemoBooking, DEMO_BLR_REF } from "@/lib/seed/demo";
import type { OfflinePack } from "@/lib/packs/types";
import { setupDb, BASE_DATE } from "./helpers";

describe("Bangalore demo trip (for showing GPS on the offline map)", () => {
  let pack: OfflinePack;
  let startDate: string;
  beforeAll(async () => {
    const { neha } = await setupDb();
    const r = await createBangaloreDemoBooking(await getDb(), neha.id, BASE_DATE);
    startDate = r.booking.startDate;
    const { getLatestPack } = await import("@/lib/packs/build");
    pack = (await getLatestPack(r.booking.id))!.pack as OfflinePack;
  });

  it("is booking SS-56001 for 2 travellers and starts today", () => {
    expect(pack.booking.ref).toBe(DEMO_BLR_REF);
    expect(pack.booking.pax).toBe(2);
    expect(pack.booking.status).toBe("confirmed");
    expect(startDate).toBe(BASE_DATE);
    expect(pack.booking.title).toMatch(/Bangalore/);
  });

  it("has street-level tiles (overview + core) covering every landmark and hotel", () => {
    const c = pack.map.cities.find((x) => x.id === "bangalore")!;
    expect(c.pmtiles).toBe("/tiles/bangalore.pmtiles");
    expect(c.core?.pmtiles).toBe("/tiles/bangalore-core.pmtiles");
    const [w, s, e, n] = c.core!.bbox;
    for (const p of Object.values(pack.places).filter((x) => x.kind !== "airport")) {
      expect(p.lon).toBeGreaterThan(w); expect(p.lon).toBeLessThan(e);
      expect(p.lat).toBeGreaterThan(s); expect(p.lat).toBeLessThan(n);
    }
    const ap = Object.values(pack.places).find((x) => x.kind === "airport")!;
    const [ow, os, oe, on] = c.bbox; // the airport (about 35 km north) is in the overview file
    expect(ap.lon).toBeGreaterThan(ow); expect(ap.lon).toBeLessThan(oe); expect(ap.lat).toBeGreaterThan(os); expect(ap.lat).toBeLessThan(on);
  });

  it("has real road and footpath routes (not straight-line samples) with turn steps", () => {
    expect(pack.routes.length).toBeGreaterThan(5);
    expect(pack.routes.filter((r) => r.approximate)).toEqual([]);
    const airport = pack.routes.find((r) => r.from.startsWith("airport_"))!;
    expect(airport.distance_m).toBeGreaterThan(20_000);
    expect(airport.geojson.geometry.coordinates.length).toBeGreaterThan(50);
    expect(airport.steps.length).toBeGreaterThan(3);
  });

  it("has real photos of real landmarks", () => {
    const withPhoto = Object.values(pack.places).filter((p) => p.kind === "poi" && p.image);
    expect(withPhoto.length).toBeGreaterThanOrEqual(5);
  });
});

describe("demo booking refs", () => {
  it("every demo ref passes the SS-##### check the agent, SOS-sync and SMS code use", async () => {
    const { DEMO_REF, DEMO_BLR_REF } = await import("@/lib/seed/demo");
    for (const r of [DEMO_REF, DEMO_BLR_REF]) expect(r).toMatch(/^SS-\d{5}$/);
  });
});
