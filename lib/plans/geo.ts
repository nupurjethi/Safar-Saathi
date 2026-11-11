import { DESTINATIONS, ORIGINS } from "@/lib/seed/data";

/**
 * Places in an uploaded plan get real coordinates from: (1) our own data (seeded airports, cities and landmarks), then
 * (2) OpenStreetMap search through the public Photon geocoder (komoot), politely (one request at a time, ~1 per second).
 * Anything not found gets no pin rather than a guessed one.
 */
export type LatLon = { lat: number; lon: number };
export type GeoHit = LatLon & { name?: string; source: "seed" | "osm" };

const UA = "travel-companion-plan-builder/1.0 (low volume, user-uploaded itineraries)";
const cache = new Map<string, GeoHit | null>();
let last = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export const KNOWN_AIRPORTS: Record<string, { name: string; lat: number; lon: number; tz: string; city: string }> = Object.fromEntries([
  ...Object.entries(ORIGINS).map(([iata, o]) => [iata, { name: `${o.name} airport (${iata})`, lat: o.lat, lon: o.lon, tz: o.tz, city: o.city }]),
  ...DESTINATIONS.map((d) => [d.iata, { name: d.airport.name, lat: d.airport.lat, lon: d.airport.lon, tz: d.timezone, city: d.name }]),
]);

/** A seeded destination with the same city name (so its offline street map, landmarks and emergency numbers can be reused). */
export function matchDestination(city: string) {
  const n = norm(city);
  const alias: Record<string, string> = { bengaluru: "bangalore", "new delhi": "delhi", bombay: "mumbai", "ho chi minh": "ho chi minh city", saigon: "ho chi minh city", male: "maldives" };
  const want = alias[n] ?? n;
  return DESTINATIONS.find((d) => norm(d.name) === want || d.slug === want.replace(/ /g, "-")) ?? null;
}

/** A seeded landmark in that city whose name matches (exact or contained), with its real coordinates. */
export function matchLandmark(city: string, place: string) {
  const d = matchDestination(city);
  if (!d) return null;
  const p = norm(place);
  return d.pois.find((x) => norm(x.name) === p) ?? d.pois.find((x) => p.length > 4 && (norm(x.name).includes(p) || p.includes(norm(x.name)))) ?? null;
}

async function photon(params: Record<string, string>): Promise<GeoHit | null> {
  const key = JSON.stringify(params);
  if (cache.has(key)) return cache.get(key)!;
  if (process.env.PLAN_GEOCODER === "off") return null;
  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  try {
    const res = await fetch(`https://photon.komoot.io/api/?${new URLSearchParams({ limit: "1", ...params })}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) { cache.set(key, null); return null; }
    const j = (await res.json()) as { features?: { geometry: { coordinates: [number, number] }; properties: { name?: string } }[] };
    const f = j.features?.[0];
    const hit = f ? { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], name: f.properties.name, source: "osm" as const } : null;
    cache.set(key, hit);
    return hit;
  } catch {
    cache.set(key, null);
    return null;
  }
}

export async function geocodeCity(city: string, country: string): Promise<GeoHit | null> {
  const d = matchDestination(city);
  if (d) return { lat: d.center[0], lon: d.center[1], name: d.name, source: "seed" };
  const o = Object.values(ORIGINS).find((x) => norm(x.city) === norm(city) || norm(x.name) === norm(city));
  if (o) return { lat: o.lat, lon: o.lon, name: o.city, source: "seed" };
  return photon({ q: `${city}, ${country}`, osm_tag: "place" });
}

export async function geocodeAirport(iata: string, city?: string): Promise<GeoHit | null> {
  const k = KNOWN_AIRPORTS[iata];
  if (k) return { lat: k.lat, lon: k.lon, name: k.name, source: "seed" };
  return (await photon({ q: `${iata} airport${city ? ` ${city}` : ""}`, osm_tag: "aeroway:aerodrome" })) ?? (city ? photon({ q: `${city} airport`, osm_tag: "aeroway:aerodrome" }) : null);
}

/** A named place (hotel, sight, restaurant) near the city centre. Only accepted within ~60 km of the city. */
export async function geocodePlace(name: string, cityName: string, near: LatLon | null, address?: string): Promise<GeoHit | null> {
  const lm = matchLandmark(cityName, name);
  if (lm) return { lat: lm.lat, lon: lm.lon, name: lm.name, source: "seed" };
  const bias: Record<string, string> = near ? { lat: String(near.lat), lon: String(near.lon) } : {};
  const tries = [address ? `${name}, ${address}` : null, `${name}, ${cityName}`, address ?? null].filter(Boolean) as string[];
  for (const q of tries) {
    const hit = await photon({ q, ...bias });
    if (hit && (!near || Math.abs(hit.lat - near.lat) < 0.6 && Math.abs(hit.lon - near.lon) < 0.6)) return hit;
  }
  return null;
}
