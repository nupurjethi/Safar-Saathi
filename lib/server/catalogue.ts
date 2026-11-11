import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { ImageCredit } from "@/lib/db/schema";
import { planTrip } from "./booking";
import { mapCities } from "@/lib/packs/build";
import { addDays } from "@/lib/time";

type Itin = typeof s.itineraries.$inferSelect;
export type Hero = { src: string; credit: ImageCredit } | null;
let cache: { at: number; rows: (Itin & { cityNames: string[]; hero: Hero })[] } | null = null;

async function all() {
  if (cache && Date.now() - cache.at < 60_000) return cache.rows;
  const db = await getDb();
  const rows = await db.select().from(s.itineraries).orderBy(asc(s.itineraries.pricePerPersonInr));
  const dests = await db.select({ slug: s.destinations.slug, name: s.destinations.name, hero: s.destinations.heroImage, credit: s.destinations.heroCredit }).from(s.destinations);
  const nm = new Map(dests.map((d) => [d.slug, d.name]));
  const hm = new Map(dests.map((d) => [d.slug, d.hero && d.credit ? { src: d.hero, credit: d.credit } : null]));
  cache = { at: Date.now(), rows: rows.map((r) => ({ ...r, cityNames: r.cities.map((c) => nm.get(c) ?? c), hero: hm.get(r.cities[0]) ?? null })) };
  return cache.rows;
}
export const clearCatalogueCache = () => { cache = null; };

export type SearchQuery = { q?: string; dest?: string; tier?: string; nights?: number; budget?: number; theme?: string; from?: string; sort?: string; page?: number; pageSize?: number };

export async function searchItineraries(q: SearchQuery) {
  const rows = await all();
  const text = q.q?.trim().toLowerCase();
  const match = (r: (typeof rows)[number], skip?: keyof SearchQuery) =>
    (skip === "q" || !text || r.title.toLowerCase().includes(text) || r.cityNames.some((c) => c.toLowerCase().includes(text)) || r.tags.some((t) => t.toLowerCase().includes(text))) &&
    (skip === "dest" || !q.dest || r.cities.includes(q.dest) || r.cityNames.some((c) => c.toLowerCase() === q.dest!.toLowerCase())) &&
    (skip === "tier" || !q.tier || r.tier === q.tier) &&
    (skip === "nights" || !q.nights || r.nights === q.nights) &&
    (skip === "budget" || !q.budget || r.pricePerPersonInr <= q.budget) &&
    (skip === "theme" || !q.theme || r.theme === q.theme) &&
    (skip === "from" || !q.from || r.originCity === q.from.toUpperCase());
  const hits = rows.filter((r) => match(r));
  const sort = q.sort ?? "price_asc";
  hits.sort((a, b) => (sort === "price_desc" ? b.pricePerPersonInr - a.pricePerPersonInr : sort === "rating" ? b.ratingSample - a.ratingSample : a.pricePerPersonInr - b.pricePerPersonInr));
  const count = (key: "theme" | "tier" | "nights" | "originCity") => {
    const m: Record<string, number> = {};
    for (const r of rows.filter((x) => match(x, key === "originCity" ? "from" : key))) m[String(r[key])] = (m[String(r[key])] ?? 0) + 1;
    return m;
  };
  const pageSize = Math.min(q.pageSize ?? 12, 60);
  const page = Math.max(q.page ?? 1, 1);
  return {
    total: hits.length, page, pageSize,
    items: hits.slice((page - 1) * pageSize, page * pageSize).map(({ cityNames, ...r }) => ({ ...r, cityNames, sample: true as const })),
    facets: { theme: count("theme"), tier: count("tier"), nights: count("nights"), from: count("originCity") },
  };
}

export const defaultStart = () => addDays(new Date().toISOString().slice(0, 10), 14);

export async function itineraryDetail(slug: string, start?: string, pax = 2) {
  const db = await getDb();
  const [it] = await db.select().from(s.itineraries).where(eq(s.itineraries.slug, slug)).limit(1);
  if (!it) return null;
  const cities = await db.select().from(s.destinations).where(inArray(s.destinations.slug, it.cities));
  const ordered = it.cities.map((c) => cities.find((x) => x.slug === c)!);
  const days = await db.select().from(s.itineraryDays).where(eq(s.itineraryDays.itineraryId, it.id)).orderBy(asc(s.itineraryDays.dayNo));
  const pois = await db.select().from(s.pois).where(inArray(s.pois.destinationId, ordered.map((c) => c.id)));
  const stars = it.tier === "budget" ? 3 : it.tier === "standard" ? 4 : 5;
  const hotels = (await db.select().from(s.hotels).where(inArray(s.hotels.destinationId, ordered.map((c) => c.id)))).filter((h) => h.stars === stars);
  const startDate = start ?? defaultStart();
  const plan = await planTrip(slug, startDate, pax, db);
  return {
    itinerary: { ...it, sample: true as const },
    cities: ordered.map((c) => ({ id: c.id, slug: c.slug, name: c.name, country: c.country, timezone: c.timezone, center: [c.centerLat, c.centerLon], bbox: c.bbox, hero: c.heroImage && c.heroCredit ? { src: c.heroImage, credit: c.heroCredit } : null })),
    mapCities: mapCities(ordered),
    days: days.map((d) => ({ dayNo: d.dayNo, title: d.title, city: ordered.find((c) => c.id === d.cityDestinationId)?.slug, items: d.items.map((i) => ({ ...i, place: i.poiId ? pois.find((p) => p.id === i.poiId)?.name : undefined })) })),
    hotels: hotels.map((h) => ({ id: h.id, name: h.name, stars: h.stars, address: h.address, city: ordered.find((c) => c.id === h.destinationId)?.slug, lat: h.lat, lon: h.lon })),
    pois: pois.filter((p) => p.category === "sight").map((p) => ({ id: p.id, name: p.name, nameLocal: p.nameLocal, city: ordered.find((c) => c.id === p.destinationId)?.slug, lat: p.lat, lon: p.lon, image: p.imageFile && p.imageCredit ? { src: p.imageFile, credit: p.imageCredit } : null })),
    pricing: plan && { startDate: plan.startDate, endDate: plan.endDate, pax, totalInr: plan.totalInr, breakdown: plan.breakdown, flights: plan.items.filter((i) => i.kind === "flight").map((i) => i.details), warnings: plan.warnings },
  };
}
