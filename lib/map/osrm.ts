import type { LatLon } from "@/lib/geo";
import type { CachedRoute } from "./route-cache";

const HOST = { drive: "https://routing.openstreetmap.de/routed-car", walk: "https://routing.openstreetmap.de/routed-foot" } as const;

type Maneuver = { type: string; modifier?: string; exit?: number; bearing_after?: number };
const compass = (deg: number) => ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(deg / 45) % 8];
type OsrmStep = { distance: number; duration: number; name: string; ref?: string; maneuver: Maneuver & { location: [number, number] } };

const dir = (m?: string) => (m ? m.replace("slight ", "slight ").replace("uturn", "U-turn") : "");
const road = (n: string, ref?: string) => (n ? ` onto ${n}` : ref ? ` onto ${ref}` : "");

/** Plain-English instruction for one OSRM maneuver. */
export function instruction(s: OsrmStep, last: boolean): string {
  const { type, modifier, exit } = s.maneuver;
  const name = s.name || s.ref || "";
  if (type === "depart") return `Head ${s.maneuver.bearing_after !== undefined ? compass(s.maneuver.bearing_after) : "out"}${name ? ` on ${name}` : ""}`.trim();
  if (type === "arrive" || last) return `Arrive${modifier ? `, destination on your ${modifier.replace("slight ", "")}` : ""}`;
  if (type === "roundabout" || type === "rotary") return `At the roundabout take exit ${exit ?? 1}${name ? ` onto ${name}` : ""}`;
  if (type === "merge") return `Merge ${dir(modifier) || "ahead"}${name ? ` onto ${name}` : ""}`;
  if (type === "on ramp") return `Take the ramp ${dir(modifier) || ""}${road(name, s.ref)}`.replace(/\s+/g, " ");
  if (type === "off ramp") return `Take the exit ${dir(modifier) || ""}${road(name, s.ref)}`.replace(/\s+/g, " ");
  if (type === "fork") return `Keep ${dir(modifier) || "straight"} at the fork${road(name, s.ref)}`;
  if (type === "end of road") return `At the end of the road turn ${dir(modifier) || "ahead"}${road(name, s.ref)}`;
  if (type === "new name" || type === "continue") return `Continue ${dir(modifier) === "straight" || !modifier ? "straight" : dir(modifier)}${name ? ` on ${name}` : ""}`;
  return `${modifier === "straight" || !modifier ? "Go straight" : `Turn ${dir(modifier)}`}${road(name, s.ref)}`;
}

/** One OSRM route (public FOSSGIS instances, OpenStreetMap data). Build-time only. */
export async function fetchOsrmRoute(a: LatLon, b: LatLon, mode: "drive" | "walk"): Promise<CachedRoute> {
  const url = `${HOST[mode]}/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson&steps=true&alternatives=false`;
  const res = await fetch(url, { headers: { "User-Agent": "travel-companion-route-prebuild/1.0 (build-time, 1 request/s)" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const j = await res.json();
  const rt = j.routes?.[0];
  if (j.code !== "Ok" || !rt) throw new Error(`OSRM ${j.code}`);
  const coords: [number, number][] = rt.geometry.coordinates.map((c: number[]) => [Number(c[0].toFixed(6)), Number(c[1].toFixed(6))]);
  const raw: OsrmStep[] = rt.legs.flatMap((l: { steps: OsrmStep[] }) => l.steps);
  const steps = raw.map((s, i) => ({
    instruction: instruction(s, i === raw.length - 1),
    distance_m: Math.round(s.distance), duration_s: Math.round(s.duration),
    lat: Number(s.maneuver.location[1].toFixed(6)), lon: Number(s.maneuver.location[0].toFixed(6)),
  }));
  return {
    mode, distance_m: Math.round(rt.distance), duration_s: Math.round(rt.duration), approximate: false,
    geojson: { type: "Feature", properties: {} as Record<string, never>, geometry: { type: "LineString", coordinates: coords } },
    steps, source: "osrm",
  };
}
