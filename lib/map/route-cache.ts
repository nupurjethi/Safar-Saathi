import fs from "node:fs";
import path from "node:path";
import type { LatLon } from "@/lib/geo";
import type { RouteStep } from "./routes";

export const ROUTE_CACHE_FILE = "lib/seed/route-cache.json";
export type CachedRoute = {
  mode: "drive" | "walk"; distance_m: number; duration_s: number; approximate: false;
  geojson: { type: "Feature"; properties: Record<string, never>; geometry: { type: "LineString"; coordinates: [number, number][] } };
  steps: RouteStep[];
  source: "osrm";
};

export const routeKey = (a: LatLon, b: LatLon, mode: string) => `${a.lat.toFixed(5)},${a.lon.toFixed(5)}>${b.lat.toFixed(5)},${b.lon.toFixed(5)}|${mode}`;

let loaded: Record<string, CachedRoute> | null = null;
/** Server-side only (pack builder). Missing file = empty cache. */
export function cachedRoute(a: LatLon, b: LatLon, mode: string): CachedRoute | null {
  if (!loaded) {
    try { loaded = JSON.parse(fs.readFileSync(path.join(process.cwd(), ROUTE_CACHE_FILE), "utf8")); } catch { loaded = {}; }
  }
  return loaded![routeKey(a, b, mode)] ?? null;
}
