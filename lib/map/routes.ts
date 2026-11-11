import { bearing } from "./offroute";
import { haversineM, type LatLon } from "@/lib/geo";
import { cachedRoute } from "./route-cache";

export type RouteStep = { instruction: string; distance_m: number; duration_s: number; lat: number; lon: number };
export type SavedRoute = {
  id: string;
  from: string; // place id
  to: string;
  fromName: string;
  toName: string;
  mode: "drive" | "walk";
  distance_m: number;
  duration_s: number;
  /** true when this is a straight-line sample (no ROUTING_API_KEY at build time). */
  approximate: boolean;
  geojson: { type: "Feature"; properties: Record<string, never>; geometry: { type: "LineString"; coordinates: [number, number][] } };
  steps: RouteStep[];
};

const cache = new Map<string, Omit<SavedRoute, "id" | "from" | "to" | "fromName" | "toName">>();

function compass(deg: number) {
  return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(deg / 45) % 8];
}

/** Straight-line sample route, clearly flagged `approximate`. Used when no routing key is configured. */
export function approximateRoute(a: LatLon, b: LatLon, mode: "drive" | "walk", toName: string) {
  const straight = haversineM(a, b);
  const dist = Math.round(straight * 1.3);
  const speed = mode === "drive" ? 30 / 3.6 : 4.5 / 3.6;
  const n = Math.max(2, Math.min(40, Math.round(straight / 150)));
  const coords: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // slight bow so the line is distinguishable from a perfectly straight pointer
    const bow = Math.sin(Math.PI * t) * 0.0004;
    coords.push([a.lon + (b.lon - a.lon) * t + bow, a.lat + (b.lat - a.lat) * t]);
  }
  const heading = bearing(a, b);
  return {
    mode, distance_m: dist, duration_s: Math.round(dist / speed), approximate: true,
    geojson: { type: "Feature" as const, properties: {} as Record<string, never>, geometry: { type: "LineString" as const, coordinates: coords } },
    steps: [
      { instruction: `Head ${compass(heading)} toward ${toName} (sample straight-line route, not turn-by-turn)`, distance_m: Math.round(dist * 0.9), duration_s: Math.round((dist * 0.9) / speed), lat: a.lat, lon: a.lon },
      { instruction: `Arrive at ${toName}`, distance_m: 0, duration_s: 0, lat: b.lat, lon: b.lon },
    ],
  };
}

/** OpenRouteService directions. Build-time only: called from the pack builder, never from the phone. */
async function orsRoute(a: LatLon, b: LatLon, mode: "drive" | "walk", key: string) {
  const profile = mode === "drive" ? "driving-car" : "foot-walking";
  const res = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: [[a.lon, a.lat], [b.lon, b.lat]], instructions: true }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`ORS ${res.status}`);
  const j = await res.json();
  const f = j.features?.[0];
  const seg = f?.properties?.segments?.[0];
  const coords: [number, number][] = f.geometry.coordinates.map((c: number[]) => [c[0], c[1]]);
  return {
    mode, distance_m: Math.round(seg.distance), duration_s: Math.round(seg.duration), approximate: false,
    geojson: { type: "Feature" as const, properties: {} as Record<string, never>, geometry: { type: "LineString" as const, coordinates: coords } },
    steps: (seg.steps as { instruction: string; distance: number; duration: number; way_points: number[] }[]).map((st) => ({
      instruction: st.instruction, distance_m: Math.round(st.distance), duration_s: Math.round(st.duration),
      lat: coords[st.way_points[0]][1], lon: coords[st.way_points[0]][0],
    })),
  };
}

export async function buildRoute(
  ids: { id: string; from: string; to: string; fromName: string; toName: string },
  a: LatLon, b: LatLon, mode?: "drive" | "walk",
): Promise<SavedRoute> {
  const m = mode ?? (haversineM(a, b) < 1500 ? "walk" : "drive");
  const key = `${a.lat.toFixed(5)},${a.lon.toFixed(5)}>${b.lat.toFixed(5)},${b.lon.toFixed(5)}|${m}`;
  let r = cache.get(key);
  if (!r) {
    const apiKey = process.env.ROUTING_API_KEY;
    try {
      // priority: your OpenRouteService key, then the pre-computed real OSM routes (npm run routes:cache), then a labelled straight line
      const saved = !apiKey ? cachedRoute(a, b, m) : null;
      r = apiKey ? await orsRoute(a, b, m, apiKey) : saved ? { mode: saved.mode, distance_m: saved.distance_m, duration_s: saved.duration_s, approximate: false, geojson: saved.geojson, steps: saved.steps } : approximateRoute(a, b, m, ids.toName);
    } catch {
      r = approximateRoute(a, b, m, ids.toName); // STUB fallback if the routing API is unreachable
    }
    cache.set(key, r);
  }
  return { ...ids, ...r };
}
