import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { publishPack } from "@/lib/packs/build";
import { llmLabel } from "@/lib/llm";
import type { CachedRoute } from "@/lib/map/route-cache";
import { zonedToUtc } from "@/lib/time";
import { extractPlan, PLAN_PROMPT_VERSION } from "./extract";
import { geocodeAirport, geocodeCity, geocodePlace, KNOWN_AIRPORTS, matchDestination, type LatLon } from "./geo";
import { validTz, type Plan } from "./schema";
import { extractTiles } from "@/lib/map/extract-tiles";

/** What is stored for a processed plan: the model's extraction plus the geography we resolved for it. */
export type StoredPlan = Plan & {
  geo: {
    citySlug: Record<string, string>; // lower-case city name -> slug
    cities: Record<string, LatLon & { tz: string; destSlug?: string; tiles?: { key: string; bytes: number; bbox: [number, number, number, number] } }>;
    airports: Record<string, LatLon & { name: string; citySlug?: string }>;
    places: Record<string, LatLon & { name: string; citySlug: string }>; // key: "place|city" lower-case
  };
  airportTz: Record<string, string>;
  routeCache?: Record<string, CachedRoute>;
  promptVersion: string;
};

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "city";
const near = (a: LatLon, b: LatLon) => Math.abs(a.lat - b.lat) < 0.8 && Math.abs(a.lon - b.lon) < 0.8;

export type ProcessResult = { ok: true; ref: string; warnings: string[] } | { ok: false; error: string };
type Step = (label: string) => void;

/**
 * The main "add travel plan" agent: documents -> Gemini reads them -> places found on the map -> a trip (booking + items) ->
 * the full offline bundle (day plan, offline map, routes, validated help guides, SOS contacts) via the normal pack builder.
 * The uploaded documents' text and images are deleted once this finishes.
 */
export async function processPlan(planId: string, userId: string, step: Step = () => {}, dbIn?: Db): Promise<ProcessResult> {
  const db = dbIn ?? (await getDb());
  const [plan] = await db.select().from(s.travelPlans).where(eq(s.travelPlans.id, planId)).limit(1);
  if (!plan || plan.userId !== userId) return { ok: false, error: "Plan not found." };
  if (plan.status === "ready" && plan.bookingId) {
    const [b] = await db.select().from(s.bookings).where(eq(s.bookings.id, plan.bookingId));
    return { ok: true, ref: b.ref, warnings: plan.warnings };
  }
  const files = await db.select().from(s.planFiles).where(eq(s.planFiles.planId, planId));
  const readable = files.filter((f) => f.status === "parsed" && (f.text || f.imageDataUrl));
  if (!readable.length) return fail(db, planId, "None of the uploaded files could be read. Use PDF, Word, Excel, CSV, a photo or text.");
  await db.update(s.travelPlans).set({ status: "processing", error: null, updatedAt: new Date() }).where(eq(s.travelPlans.id, planId));

  step("Reading your documents with Gemini");
  const ex = await extractPlan({ files: readable.map((f) => ({ name: f.name, text: f.text ?? undefined, imageDataUrl: f.imageDataUrl ?? undefined })) });
  if (!ex.ok) return fail(db, planId, ex.error);
  const p = ex.plan;
  const warnings = [...ex.warnings, ...files.filter((f) => f.status !== "parsed").map((f) => `${f.name}: ${f.note ?? "skipped"}`)];

  step("Finding your places on the map");
  const geo: StoredPlan["geo"] = { citySlug: {}, cities: {}, airports: {}, places: {} };
  const used = new Set<string>();
  for (const c of p.cities) {
    const dest = matchDestination(c.name);
    let slug = dest?.slug ?? slugify(c.name);
    while (used.has(slug) && geo.citySlug[c.name.toLowerCase()] !== slug) slug = `${slug}-2`;
    used.add(slug);
    geo.citySlug[c.name.toLowerCase()] = slug;
    const hit = await geocodeCity(c.name, c.country);
    const tz = validTz(c.timezone) ? c.timezone : dest?.timezone ?? "UTC";
    if (!validTz(c.timezone) && !dest) warnings.push(`${c.name}: time zone unknown, times shown as written.`);
    geo.cities[slug] = { lat: hit?.lat ?? NaN, lon: hit?.lon ?? NaN, tz, destSlug: dest?.slug };
  }
  const cityByName = (name?: string) => (name ? geo.citySlug[name.toLowerCase()] : undefined);
  const airportTz: Record<string, string> = {};
  for (const f of p.flights) {
    for (const [iata, cityName, tzIn] of [[f.from, f.fromCity, f.fromTimezone], [f.to, f.toCity, f.toTimezone]] as const) {
      if (!geo.airports[iata]) {
        const hit = await geocodeAirport(iata, cityName);
        if (hit) {
          const slug = cityByName(cityName) ?? cityByName(KNOWN_AIRPORTS[iata]?.city) ?? Object.entries(geo.cities).find(([, c]) => Number.isFinite(c.lat) && near(c, hit))?.[0];
          geo.airports[iata] = { lat: hit.lat, lon: hit.lon, name: hit.name ?? `${iata} airport`, citySlug: slug };
        } else warnings.push(`Airport ${iata} could not be found on the map.`);
      }
      if (!airportTz[iata]) {
        const slug = geo.airports[iata]?.citySlug ?? cityByName(cityName);
        airportTz[iata] = validTz(tzIn) ? tzIn! : KNOWN_AIRPORTS[iata]?.tz ?? (slug ? geo.cities[slug]?.tz : undefined) ?? "UTC";
      }
    }
  }
  // a city that could not be found by name uses its airport's position
  for (const [slug, c] of Object.entries(geo.cities)) {
    if (Number.isFinite(c.lat)) continue;
    const a = Object.values(geo.airports).find((x) => x.citySlug === slug) ?? Object.values(geo.airports)[0];
    if (a) { c.lat = a.lat; c.lon = a.lon; } else { c.lat = 0; c.lon = 0; }
    warnings.push(`A city in your plan could not be found on the map; its pins may be off.`);
  }
  const hotelGeo: (LatLon & { exact: boolean })[] = [];
  for (const h of p.hotels) {
    const slug = cityByName(h.city) ?? Object.keys(geo.cities)[0];
    const centre = geo.cities[slug];
    const hit = await geocodePlace(h.name, h.city, centre, h.address);
    if (!hit) warnings.push(`${h.name}: not found on the map, its pin is at the city centre.`);
    hotelGeo.push(hit ? { lat: hit.lat, lon: hit.lon, exact: true } : { lat: centre.lat, lon: centre.lon, exact: false });
  }
  let lookups = 0;
  for (const a of p.activities) {
    if (!a.place || lookups >= 25) continue;
    const key = `${a.place}|${a.city}`.toLowerCase();
    if (geo.places[key]) continue;
    const slug = cityByName(a.city) ?? Object.keys(geo.cities)[0];
    lookups++;
    const hit = await geocodePlace(a.place, a.city, geo.cities[slug]);
    if (hit) geo.places[key] = { lat: hit.lat, lon: hit.lon, name: a.place, citySlug: slug };
  }

  // offline street map: cities we already cover reuse our pre-built tiles; others get a map file made now from OpenStreetMap
  for (const [slug, c] of Object.entries(geo.cities)) {
    if (c.destSlug || process.env.PLAN_TILES === "off") continue;
    const name = p.cities.find((x) => geo.citySlug[x.name.toLowerCase()] === slug)?.name ?? slug;
    step(`Making the offline street map for ${name}`);
    const pts: LatLon[] = [c, ...hotelGeo.filter((_, i) => (cityByName(p.hotels[i].city) ?? "") === slug), ...Object.values(geo.places).filter((x) => x.citySlug === slug), ...Object.values(geo.airports).filter((x) => x.citySlug === slug)]
      .filter((x) => Number.isFinite(x.lat) && Math.abs(x.lat - c.lat) < 0.5 && Math.abs(x.lon - c.lon) < 0.5);
    const lats = pts.map((x) => x.lat), lons = pts.map((x) => x.lon);
    const pad = 0.025, half = (a: number, b: number) => Math.max((b - a) / 2 + pad, 0.04);
    const cx = (Math.min(...lons) + Math.max(...lons)) / 2, cy = (Math.min(...lats) + Math.max(...lats)) / 2;
    const hx = Math.min(half(Math.min(...lons), Math.max(...lons)), 0.25), hy = Math.min(half(Math.min(...lats), Math.max(...lats)), 0.25);
    const bbox: [number, number, number, number] = [cx - hx, cy - hy, cx + hx, cy + hy].map((v) => Math.round(v * 1e4) / 1e4) as [number, number, number, number];
    try {
      const r = await extractTiles(bbox, { maxZoom: 14, maxTiles: 1800 });
      const key = `plan-${planId.slice(0, 8)}-${slug}`.slice(0, 80);
      await db.insert(s.mapTiles).values({ key, bytes: r.bytes, sha256: r.sha256, bbox: r.bbox, maxZoom: r.maxZoom, data: r.data }).onConflictDoUpdate({ target: s.mapTiles.key, set: { bytes: r.bytes, sha256: r.sha256, bbox: r.bbox, maxZoom: r.maxZoom, data: r.data, updatedAt: new Date() } });
      c.tiles = { key, bytes: r.bytes, bbox: r.bbox };
    } catch (e) {
      warnings.push(`The offline street map for ${name} could not be made (${e instanceof Error ? e.message.slice(0, 60) : "error"}). Pins and routes still work offline.`);
    }
  }

  step("Creating your trip");
  const stored: StoredPlan = { ...p, geo, airportTz, promptVersion: PLAN_PROMPT_VERSION };
  const ref = await freeRef(db);
  const flightItems = p.flights.map((f, i) => {
    const [dd, dt] = f.departLocal.split("T"), [ad, at] = f.arriveLocal.split("T");
    const leg = i === 0 ? "outbound" : i === p.flights.length - 1 ? "return" : "intercity";
    return { kind: "flight", refId: null, date: dd, priceInr: 0, status: "confirmed", details: {
      flightId: null, flightNo: f.flightNo, carrierName: f.airline, from: f.from, to: f.to, departAt: zonedToUtc(dd, dt, airportTz[f.from] ?? "UTC").toISOString(), arriveAt: zonedToUtc(ad, at, airportTz[f.to] ?? "UTC").toISOString(),
      farePerPaxInr: 0, pax: p.pax, leg, pnr: f.pnr ?? "", changeFeeInr: 0, terminal: f.terminal ?? null, fareRules: "As in your ticket.", fromUpload: true,
    } };
  });
  const hotelItemsIn = p.hotels.map((h, i) => {
    const slug = cityByName(h.city) ?? Object.keys(geo.cities)[0];
    const nights = Math.max(1, Math.round((Date.parse(`${h.checkout}T00:00:00Z`) - Date.parse(`${h.checkin}T00:00:00Z`)) / 86400e3));
    return { kind: "hotel", refId: null, date: h.checkin, priceInr: 0, status: "confirmed", details: {
      hotelId: null, name: h.name, address: h.address, addressLocal: h.address, phone: h.phone ?? "", lat: hotelGeo[i].lat, lon: hotelGeo[i].lon, locationExact: hotelGeo[i].exact,
      checkinDate: h.checkin, checkoutDate: h.checkout, nights, rooms: h.rooms ?? Math.max(1, Math.ceil(p.pax / 2)), roomType: "as booked", rateInr: 0, checkinTime: "", checkoutTime: "",
      city: slug, cityName: p.cities.find((c) => geo.citySlug[c.name.toLowerCase()] === slug)?.name ?? h.city, rules: ["Check your hotel confirmation for check-in time and rules."], confirmation: h.confirmation ?? null, fromUpload: true,
    } };
  });
  const insurance = p.contacts.find((c) => /insur/i.test(c.label));
  const booking = await db.transaction(async (tx0) => {
    const tx = tx0 as unknown as Db;
    const [bk] = await tx.insert(s.bookings).values({ ref, userId, itineraryId: null, planId, source: "upload", startDate: p.startDate, endDate: p.endDate < p.startDate ? p.startDate : p.endDate, pax: p.pax, status: "confirmed", totalInr: 0, packVersion: 0, insurancePhoneSample: insurance?.phone ?? null }).returning();
    const rows = [...flightItems, ...hotelItemsIn].map((x) => ({ ...x, bookingId: bk.id }));
    if (rows.length) await tx.insert(s.bookingItems).values(rows as never);
    if (p.travellers.length) await tx.insert(s.travellers).values(p.travellers.map((t) => ({ userId, bookingId: bk.id, name: t.name, ageBand: "adult" })));
    await tx.update(s.travelPlans).set({ extracted: stored as never, title: p.title, bookingId: bk.id, warnings, model: llmLabel(), updatedAt: new Date() }).where(eq(s.travelPlans.id, planId));
    await tx.insert(s.events).values({ name: "plan_uploaded", userId, bookingId: bk.id, props: { files: files.length, flights: p.flights.length, hotels: p.hotels.length, activities: p.activities.length } });
    return bk;
  });

  step("Building your offline guide, map, routes and SOS");
  try {
    await publishPack(booking.id, db, { change: "Travel plan uploaded" });
  } catch (e) {
    return fail(db, planId, `Your trip was read, but the offline guide could not be built: ${e instanceof Error ? e.message : String(e)}`);
  }
  await db.update(s.travelPlans).set({ status: "ready", updatedAt: new Date() }).where(eq(s.travelPlans.id, planId));
  // the documents themselves are not kept: only the structured plan above
  await db.update(s.planFiles).set({ text: null, imageDataUrl: null, updatedAt: new Date() }).where(eq(s.planFiles.planId, planId));
  return { ok: true, ref: booking.ref, warnings };
}

async function fail(db: Db, planId: string, error: string): Promise<ProcessResult> {
  await db.update(s.travelPlans).set({ status: "failed", error, updatedAt: new Date() }).where(eq(s.travelPlans.id, planId));
  return { ok: false, error };
}

async function freeRef(db: Db) {
  for (let i = 0; i < 20; i++) {
    const ref = `SS-${Math.floor(10000 + Math.random() * 89999)}`;
    const [hit] = await db.select({ id: s.bookings.id }).from(s.bookings).where(eq(s.bookings.ref, ref)).limit(1);
    if (!hit) return ref;
  }
  throw new Error("NO_FREE_REF");
}
