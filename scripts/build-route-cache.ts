import { config } from "dotenv";
config({ path: ".env.local" });
import fs from "node:fs";
import path from "node:path";
import { generateSeed } from "@/lib/seed/generate";
import { haversineM } from "@/lib/geo";
import { routeKey, ROUTE_CACHE_FILE, type CachedRoute } from "@/lib/map/route-cache";
import { fetchOsrmRoute } from "@/lib/map/osrm";

/**
 * Pre-computes REAL road / footpath routes (geometry + turn-by-turn steps) for every hotel, airport and landmark pair
 * the pack builder can ask for, and stores them in lib/seed/route-cache.json. The phone and the pack builder then read
 * this file: no routing call is ever made from a phone, and pack builds need no network.
 *
 * Routing engine: the public OSRM instances run by FOSSGIS (routing.openstreetmap.de), on OpenStreetMap data. They are
 * a free community service, so this script is polite: one request at a time, ~1.2 s apart, backs off on 429/5xx, and is
 * resumable (rerun it and it only fetches what is missing). A ROUTING_API_KEY (OpenRouteService) still takes priority
 * at pack-build time if you set one.
 *
 * Usage: npm run routes:cache            (all cities)
 *        npm run routes:cache -- paris   (some cities)
 */
const want = new Set(process.argv.slice(2));
const { destinations, pois, hotels } = generateSeed({ baseDate: "2026-01-01", flightDays: 1 });
const file = path.join(process.cwd(), ROUTE_CACHE_FILE);
const cache: Record<string, CachedRoute> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};

type Pt = { lat: number; lon: number };
const jobs: { a: Pt; b: Pt; mode: "drive" | "walk"; city: string }[] = [];
for (const d of destinations) {
  if (want.size && !want.has(d.slug)) continue;
  const airport = pois.find((p) => p.destinationId === d.id && p.category === "airport");
  const sights = pois.filter((p) => p.destinationId === d.id && p.category !== "airport");
  for (const h of hotels.filter((x) => x.destinationId === d.id)) {
    if (airport) { jobs.push({ a: airport, b: h, mode: "drive", city: d.slug }); jobs.push({ a: h, b: airport, mode: "drive", city: d.slug }); }
    for (const p of sights) jobs.push({ a: h, b: p, mode: haversineM(h, p) < 1500 ? "walk" : "drive", city: d.slug });
  }
}
async function main() {
const todo = jobs.filter((j) => !cache[routeKey(j.a, j.b, j.mode)]);
console.log(`${jobs.length} routes wanted, ${jobs.length - todo.length} cached, ${todo.length} to fetch (~${Math.ceil((todo.length * 1.3) / 60)} min)`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let done = 0, failed = 0;
const save = () => fs.writeFileSync(file, JSON.stringify(cache));
for (const j of todo) {
  let r: CachedRoute | null = null;
  for (let attempt = 0; attempt < 4 && !r; attempt++) {
    try { r = await fetchOsrmRoute(j.a, j.b, j.mode); } catch (e) { await sleep(2500 * (attempt + 1)); if (attempt === 3) console.warn(`  skip ${j.city} ${j.a.lat},${j.a.lon} > ${j.b.lat},${j.b.lon}: ${String(e).slice(0, 80)}`); }
  }
  if (r) cache[routeKey(j.a, j.b, j.mode)] = r; else failed++;
  if (++done % 25 === 0) { save(); console.log(`  ${done}/${todo.length} (${j.city})`); }
  await sleep(1200);
}
save();
console.log(`done: ${Object.keys(cache).length} routes cached, ${failed} failed (those fall back to labelled straight-line samples)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
