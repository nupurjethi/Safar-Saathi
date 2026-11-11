import { layers, namedFlavor, type Flavor } from "@protomaps/basemaps";
import type { StyleSpecification, LayerSpecification } from "maplibre-gl";
import type { PackMapCity } from "@/lib/packs/types";

/**
 * Offline basemap style: real OpenStreetMap vector tiles (Protomaps) drawn like a consumer map: street names,
 * building footprints, parks, water, rail, transit stops and POI icons (cafes, hotels, museums, hospitals...).
 *
 * Everything is local. Tiles come from the PMTiles files cached on the phone, label glyphs from /map/fonts and
 * icons from /map/sprites (all listed in the offline pack). No remote style, glyph or sprite URL exists, so the map
 * renders in airplane mode.
 *
 * Two PMTiles per city (scripts/build-tiles.sh):
 *   overview  whole city + airport, zoom 0-12  -> drawn first, over-zoomed beyond 12
 *   core      hotels + landmarks, zoom 0-15    -> drawn on top from zoom 13, hides the over-zoomed overview underneath
 */
const LIGHT_TWEAKS: Partial<Flavor> = {
  background: "#e8eaed", earth: "#f5f3ee", water: "#a8d3f0", park_a: "#c9e7bf", park_b: "#bfe0b4", wood_a: "#b7dca9", wood_b: "#add6a0",
  buildings: "#e3ddd2", pedestrian: "#efece4", sand: "#f1e8cc", beach: "#f4ecd0", hospital: "#f6dcd9", school: "#efe5d8", industrial: "#ece8e2",
  major: "#fff3c4", major_casing_early: "#e2b844", major_casing_late: "#e2b844", highway: "#fbc65a", highway_casing_early: "#d99a2b", highway_casing_late: "#d99a2b",
  minor_a: "#ffffff", minor_b: "#ffffff", minor_casing: "#d9d4c8", minor_service: "#ffffff", minor_service_casing: "#dedacd", other: "#ffffff",
  city_label: "#1f2933", subplace_label: "#4b5563", roads_label_minor: "#5f6368", roads_label_major: "#3c4043", ocean_label: "#4e7fb3", railway: "#b3b8bf",
};
const DARK_TWEAKS: Partial<Flavor> = {
  background: "#16171b", earth: "#23252b", water: "#0f3354", park_a: "#1d3a28", park_b: "#1a3324", wood_a: "#183021", wood_b: "#162b1d", buildings: "#31343c", pedestrian: "#2a2c33",
  minor_a: "#454954", minor_b: "#454954", minor_casing: "#17181c", minor_service: "#3c404a", minor_service_casing: "#17181c", other: "#3c404a",
  major: "#5c6270", major_casing_early: "#17181c", major_casing_late: "#17181c", highway: "#a78b45", highway_casing_early: "#17181c", highway_casing_late: "#17181c",
  roads_label_minor: "#c4c9d4", roads_label_minor_halo: "#1b1c21", roads_label_major: "#e3e6ee", roads_label_major_halo: "#1b1c21", subplace_label: "#c4c9d4", city_label: "#f1f3f8",
};

const flavorFor = (dark: boolean): Flavor => ({ ...namedFlavor(dark ? "dark" : "light"), ...(dark ? DARK_TWEAKS : LIGHT_TWEAKS) });

const origin = () => (typeof location !== "undefined" ? location.origin : "http://localhost");
const abs = (p: string) => new URL(p, origin()).href;
type Layer = LayerSpecification & { id: string; source?: string; minzoom?: number; maxzoom?: number };

function prefixed(source: string, flavor: Flavor, prefix: string, opts: { minzoom?: number; maxzoom?: number; symbolMaxzoom?: number; noEarthBackground?: boolean }): Layer[] {
  return (layers(source, flavor, { lang: "en" }) as Layer[])
    .filter((l) => l.type !== "background")
    .map((l) => {
      const out: Layer = { ...l, id: `${prefix}${l.id}` };
      const lo = opts.minzoom, hi = l.type === "symbol" && opts.symbolMaxzoom !== undefined ? opts.symbolMaxzoom : opts.maxzoom;
      if (lo !== undefined) out.minzoom = Math.max(lo, l.minzoom ?? 0);
      if (hi !== undefined) out.maxzoom = Math.min(hi, l.maxzoom ?? 24);
      return out;
    });
}

export function buildStyle(cities: PackMapCity[], dark: boolean): StyleSpecification {
  const flavor = flavorFor(dark);
  const sources: StyleSpecification["sources"] = {};
  const overview: Layer[] = [];
  const core: Layer[] = [];
  for (const c of cities) {
    if (c.pmtiles) {
      const src = `ov-${c.id}`;
      sources[src] = { type: "vector", url: `pmtiles://${abs(c.pmtiles)}`, attribution: "© OpenStreetMap contributors" };
      // overview labels stop at zoom 13, where the core file's finer labels take over
      overview.push(...prefixed(src, flavor, `${src}-`, { symbolMaxzoom: 13 }));
    }
    if (c.core?.pmtiles) {
      const src = `core-${c.id}`;
      sources[src] = { type: "vector", url: `pmtiles://${abs(c.core.pmtiles)}`, attribution: "© OpenStreetMap contributors" };
      core.push(...prefixed(src, flavor, `${src}-`, { minzoom: 13 }));
    }
  }
  return {
    version: 8,
    name: dark ? "Safar Saathi offline (dark)" : "Safar Saathi offline",
    metadata: { attribution: "© OpenStreetMap contributors" },
    glyphs: `${origin()}/map/fonts/{fontstack}/{range}.pbf`, // string concat: new URL() would percent-encode the {braces} maplibre fills in
    sprite: abs(`/map/sprites/${dark ? "dark" : "light"}`),
    sources,
    layers: [{ id: "background", type: "background", paint: { "background-color": flavor.background } }, ...overview, ...core] as LayerSpecification[],
  };
}

/** True when the pack has at least one city with real tiles. */
export const hasRealTiles = (cities: PackMapCity[]) => cities.some((c) => c.pmtiles || c.core?.pmtiles);
