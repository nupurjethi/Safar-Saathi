import { describe, expect, it } from "vitest";
import { buildStyle, hasRealTiles } from "@/lib/map/style";
import { instruction } from "@/lib/map/osrm";
import type { PackMapCity } from "@/lib/packs/types";

const city = (id: string, core = true): PackMapCity => ({
  id, name: id, pmtiles: `/tiles/${id}.pmtiles`, bytes: 5e6, bbox: [2.2, 48.8, 2.6, 49.0], center: [48.85, 2.35],
  core: core ? { pmtiles: `/tiles/${id}-core.pmtiles`, bytes: 1.2e7, bbox: [2.27, 48.83, 2.37, 48.9] } : null,
});

describe("offline map style", () => {
  it("draws a real street map from local tiles, fonts and sprites only (no remote URLs)", () => {
    for (const dark of [false, true]) {
      const st = buildStyle([city("paris"), city("rome")], dark);
      expect(Object.keys(st.sources).sort()).toEqual(["core-paris", "core-rome", "ov-paris", "ov-rome"]);
      for (const s of Object.values(st.sources)) expect((s as { url: string }).url).toMatch(/^pmtiles:\/\/http:\/\/localhost\/tiles\//);
      expect(st.glyphs).toBe("http://localhost/map/fonts/{fontstack}/{range}.pbf");
      expect(String(st.sprite)).toBe(`http://localhost/map/sprites/${dark ? "dark" : "light"}`);
      expect(JSON.stringify(st)).not.toMatch(/https:\/\//);
      const ids = st.layers.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length); // unique ids across cities and tile sets
      for (const l of st.layers) if ("source" in l && l.source) expect(st.sources[l.source]).toBeTruthy();
    }
  });
  it("has the layers that make it look like a real map: roads, buildings, water, parks, street names, place icons", () => {
    const st = buildStyle([city("paris")], false);
    const srcLayers = new Set(st.layers.map((l) => ("source-layer" in l ? l["source-layer"] : undefined)).filter(Boolean));
    for (const need of ["earth", "water", "roads", "buildings", "landuse", "pois", "places"]) expect(srcLayers.has(need)).toBe(true);
    const symbols = st.layers.filter((l) => l.type === "symbol");
    expect(symbols.length).toBeGreaterThan(10);
    expect(symbols.some((l) => "layout" in l && l.layout && "icon-image" in l.layout)).toBe(true);
  });
  it("shows street-level detail only from the core file, from zoom 13", () => {
    const st = buildStyle([city("paris")], false);
    const coreLayers = st.layers.filter((l) => l.id.startsWith("core-paris-"));
    expect(coreLayers.length).toBeGreaterThan(30);
    for (const l of coreLayers) expect((l as { minzoom?: number }).minzoom ?? 0).toBeGreaterThanOrEqual(13);
    const ovSymbols = st.layers.filter((l) => l.id.startsWith("ov-paris-") && l.type === "symbol");
    for (const l of ovSymbols) expect((l as { maxzoom?: number }).maxzoom ?? 24).toBeLessThanOrEqual(13);
  });
  it("works with an overview-only city and with no tiles at all", () => {
    expect(Object.keys(buildStyle([city("paris", false)], false).sources)).toEqual(["ov-paris"]);
    const none = { ...city("x", false), pmtiles: null } as PackMapCity;
    expect(hasRealTiles([none])).toBe(false);
    expect(buildStyle([none], false).layers.length).toBe(1);
  });
});

describe("turn-by-turn wording", () => {
  const step = (type: string, modifier: string | undefined, name: string, extra: Record<string, unknown> = {}) => ({ distance: 100, duration: 10, name, maneuver: { type, modifier, location: [0, 0] as [number, number], ...extra } });
  it("turns real OSRM maneuvers into plain instructions", () => {
    expect(instruction(step("depart", "right", "Rue de Rivoli", { bearing_after: 92 }), false)).toBe("Head east on Rue de Rivoli");
    expect(instruction(step("turn", "left", "Avenue Foch"), false)).toBe("Turn left onto Avenue Foch");
    expect(instruction(step("roundabout", "right", "Place de l'Étoile", { exit: 3 }), false)).toBe("At the roundabout take exit 3 onto Place de l'Étoile");
    expect(instruction(step("arrive", "left", ""), true)).toMatch(/^Arrive/);
  });
});
