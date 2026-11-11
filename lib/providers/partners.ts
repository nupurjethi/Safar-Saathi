import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { haversineKm } from "@/lib/geo";
import { createRng } from "@/lib/rng";
import { CARRIERS, DESTINATIONS, ORIGINS } from "@/lib/seed/data";
import { addDays, localDate, localTime, zonedToUtc } from "@/lib/time";
import { PLATFORMS, PLATFORM_IDS, isInternational, type PlatformId } from "./platforms";

/**
 * The Safar Saathi MOCK PARTNER API: sample flights and hotels stored in our own database (Neon in production), standing in
 * for an airline/hotel price API. It is SAMPLE DATA, never live prices, and every result says so.
 *  - Flights: read from the `flights` table; a route/day with no rows (e.g. from an uploaded travel plan) gets 5-6 plausible
 *    flights generated deterministically and stored, so later searches read the same rows.
 *  - Hotels: seeded catalogue hotels + room inventory for known cities; elsewhere 5 hotels are generated near the given point
 *    and stored in `mock_hotels`.
 *  - Each option is priced per booking platform from `partner_markups` (base x markup x discount + fee), so the agent can show
 *    "MakeMyTrip ₹x, Goibibo ₹y" and send the traveller to the platform they are logged in to, where they pay.
 */
export const SAMPLE_SOURCE = "Sample fares from the Safar Saathi mock partner API, not live prices";
export const SAMPLE_PROVIDER = "Safar Saathi mock partner API";

export type PartnerKind = "flight" | "hotel";
export type Markup = { platform: PlatformId; kind: PartnerKind; markupBps: number; feeInr: number; discountBps: number; note?: string | null };
export type PlatformPrice = { platform: PlatformId; name: string; totalInr: number; url: string };

/** Sample markup rules per platform (stored in partner_markups; values are illustrative, not the platforms' real fees). */
export const DEFAULT_MARKUPS: Markup[] = [
  { platform: "makemytrip", kind: "flight", markupBps: 350, feeInr: 299, discountBps: 0, note: "Sample: 3.5% markup + ₹299 convenience fee" },
  { platform: "goibibo", kind: "flight", markupBps: 300, feeInr: 249, discountBps: 100, note: "Sample: 3% markup, 1% offer, ₹249 fee" },
  { platform: "cleartrip", kind: "flight", markupBps: 250, feeInr: 349, discountBps: 0, note: "Sample: 2.5% markup + ₹349 fee" },
  { platform: "ixigo", kind: "flight", markupBps: 200, feeInr: 199, discountBps: 50, note: "Sample: 2% markup, 0.5% offer, ₹199 fee" },
  { platform: "makemytrip", kind: "hotel", markupBps: 800, feeInr: 0, discountBps: 500, note: "Sample: 8% markup, 5% member offer" },
  { platform: "goibibo", kind: "hotel", markupBps: 700, feeInr: 99, discountBps: 300, note: "Sample: 7% markup, 3% offer, ₹99 fee" },
  { platform: "cleartrip", kind: "hotel", markupBps: 600, feeInr: 149, discountBps: 0, note: "Sample: 6% markup + ₹149 fee" },
  { platform: "ixigo", kind: "hotel", markupBps: 500, feeInr: 199, discountBps: 0, note: "Sample: 5% markup + ₹199 fee" },
];

/** Idempotent: inserts the sample markup rules that are missing. Safe to run against a live database. Returns rows inserted. */
export async function ensurePartnerMarkups(db: Db): Promise<number> {
  const inserted = await db.insert(s.partnerMarkups).values(DEFAULT_MARKUPS.map((m) => ({ ...m, note: m.note ?? null }))).onConflictDoNothing().returning({ id: s.partnerMarkups.id });
  return inserted.length;
}

async function loadMarkups(db: Db, kind: PartnerKind): Promise<Markup[]> {
  let rows = await db.select().from(s.partnerMarkups).where(eq(s.partnerMarkups.kind, kind));
  if (rows.length < PLATFORM_IDS.length) { await ensurePartnerMarkups(db); rows = await db.select().from(s.partnerMarkups).where(eq(s.partnerMarkups.kind, kind)); }
  return rows.filter((r) => (PLATFORM_IDS as string[]).includes(r.platform)).map((r) => ({ platform: r.platform as PlatformId, kind, markupBps: r.markupBps, feeInr: r.feeInr, discountBps: r.discountBps, note: r.note }));
}

/** price = base x (1 + markup) x (1 - discount) + fee, rounded to the rupee. */
export const platformPrice = (baseInr: number, m: Pick<Markup, "markupBps" | "discountBps" | "feeInr">) =>
  Math.round(baseInr * (1 + m.markupBps / 10000) * (1 - m.discountBps / 10000) + m.feeInr);

export function platformPricesFor(baseInr: number, markups: Markup[], urlFor: (p: PlatformId) => string): PlatformPrice[] {
  return markups.map((m) => ({ platform: m.platform, name: PLATFORMS[m.platform].name, totalInr: platformPrice(baseInr, m), url: urlFor(m.platform) })).sort((a, b) => a.totalInr - b.totalInr);
}

const hash = (str: string) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Known airports (seeded origins + destinations) for coordinates and time zone. Others fall back to the caller's time zone. */
export function airportInfo(iata: string): { lat: number; lon: number; tz: string } | undefined {
  const o = ORIGINS[iata];
  if (o) return { lat: o.lat, lon: o.lon, tz: o.tz };
  const d = DESTINATIONS.find((x) => x.iata === iata);
  return d ? { lat: d.airport.lat, lon: d.airport.lon, tz: d.timezone } : undefined;
}

/* --------------------------------- flights --------------------------------- */

export type FlightQueryIn = { from: string; to: string; date: string; pax: number; fromTz?: string; toTz?: string };
export type PartnerFlightOffer = {
  id: string; provider: "mock"; providerLabel: string; source: string; totalInr: number; perTravellerInr: number;
  breakup: { label: string; amountInr: number }[];
  facts: { carrier: string; flightNo: string; from: string; to: string; departLocal: string; arriveLocal: string; stops: number; durationMin: number };
  validUntil: string; platformPrices: PlatformPrice[];
};

/** Deterministic sample flights for one route and day (same input, same flights). Pure: does not touch the database. */
export function generateMockFlights(q: { from: string; to: string; date: string; fromTz: string }): (typeof s.flights.$inferInsert)[] {
  const a = airportInfo(q.from), b = airportInfo(q.to);
  const dist = a && b ? haversineKm(a, b) : 1200;
  const dur = Math.max(45, Math.min(900, Math.round(((dist / 780) * 60 + 35) / 5) * 5));
  const r = createRng(hash(`${q.from}-${q.to}-${q.date}`));
  const count = r.int(5, 6);
  const slots = [6 * 60 + 10, 8 * 60 + 25, 10 * 60 + 40, 13 * 60 + 5, 15 * 60 + 30, 18 * 60 + 15, 20 * 60 + 50];
  const out: (typeof s.flights.$inferInsert)[] = [];
  for (let k = 0; k < count; k++) {
    const depMin = slots[(k + r.int(0, 6)) % slots.length] + r.int(-3, 3) * 5;
    const hh = String(Math.floor(depMin / 60)).padStart(2, "0"), mm = String(depMin % 60).padStart(2, "0");
    const departAt = zonedToUtc(q.date, `${hh}:${mm}`, q.fromTz);
    const carrier = r.pick(CARRIERS);
    const fare = Math.round((dist * (3.8 + r.next() * 1.2) + 2500) / 50) * 50;
    const changeFee = r.int(2, 5) * 500;
    out.push({
      id: r.uuid(), flightNo: `${carrier.code}${r.int(100, 989)}`, carrierName: carrier.name, fromIata: q.from, toIata: q.to,
      departAt, arriveAt: new Date(departAt.getTime() + dur * 60000), fareInr: fare, seatsLeft: r.int(3, 12), changeFeeInr: changeFee,
      fareRules: { changeAllowed: true, changeFeeInr: changeFee, fareDifferenceApplies: true, notes: "Sample fare rules (mock partner API)." },
    });
  }
  return out;
}

/** Sample flights for a route and day from the database, generating and storing them first if there are none. */
export async function mockFlightOffers(q: FlightQueryIn, dbIn?: Db): Promise<{ offers: PartnerFlightOffer[]; generated: boolean }> {
  const db = dbIn ?? (await getDb());
  const from = q.from.toUpperCase(), to = q.to.toUpperCase();
  const fromTz = q.fromTz ?? airportInfo(from)?.tz ?? "UTC";
  const toTz = q.toTz ?? airportInfo(to)?.tz ?? fromTz;
  const lo = zonedToUtc(q.date, "00:00", fromTz), hi = zonedToUtc(addDays(q.date, 1), "00:00", fromTz);
  const read = () => db.select().from(s.flights).where(and(eq(s.flights.fromIata, from), eq(s.flights.toIata, to), gte(s.flights.departAt, lo), lt(s.flights.departAt, hi))).orderBy(asc(s.flights.departAt));
  let rows = await read();
  let generated = false;
  if (!rows.length) {
    const gen = generateMockFlights({ from, to, date: q.date, fromTz });
    // ids are deterministic, so a concurrent request generating the same day cannot create duplicates
    await db.insert(s.flights).values(gen).onConflictDoNothing();
    rows = await read();
    generated = true;
  }
  const markups = await loadMarkups(db, "flight");
  const international = isInternational(from, to);
  const pax = Math.max(1, q.pax);
  const offers = rows.filter((f) => f.seatsLeft >= 1).map((f): PartnerFlightOffer => {
    const total = f.fareInr * pax;
    return {
      id: `mock:${f.id}`, provider: "mock", providerLabel: SAMPLE_PROVIDER, source: SAMPLE_SOURCE, totalInr: total, perTravellerInr: f.fareInr,
      breakup: [{ label: `Sample base fare (₹${f.fareInr} per person × ${pax})`, amountInr: total }],
      facts: { carrier: f.carrierName, flightNo: f.flightNo, from, to, departLocal: `${localDate(f.departAt, fromTz)}T${localTime(f.departAt, fromTz)}`, arriveLocal: `${localDate(f.arriveAt, toTz)}T${localTime(f.arriveAt, toTz)}`, stops: 0, durationMin: Math.round((f.arriveAt.getTime() - f.departAt.getTime()) / 60000) },
      validUntil: new Date(Date.now() + 15 * 60_000).toISOString(),
      platformPrices: platformPricesFor(total, markups, (p) => PLATFORMS[p].searchUrl({ from, to, date: q.date, pax, international })),
    };
  });
  return { offers, generated };
}

/* --------------------------------- hotels ---------------------------------- */

export type HotelQueryIn = { lat: number; lon: number; cityName: string; citySlug?: string; checkin: string; checkout: string; rooms: number; adults: number };
export type PartnerHotelOffer = {
  id: string; provider: "mock"; providerLabel: string; source: string; hotelName: string; address?: string; lat?: number; lon?: number; roomType?: string;
  totalInr: number; perNightInr: number; breakup: { label: string; amountInr: number }[]; refundable: boolean; cancellation?: string; validUntil: string;
  platformPrices: PlatformPrice[];
};

const NAMES = ["Saffron Court", "Lotus Stay", "Harbour Lane Hotel", "Banyan Residency", "Cedar Point Inn", "Marigold Suites", "Riverstone Hotel", "Peacock Grand", "Monsoon House", "Juniper Rooms"];
const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3));
export const areaKey = (lat: number, lon: number) => `${lat.toFixed(1)},${lon.toFixed(1)}`;

/** Deterministic sample hotels around a point (same area, same hotels). Pure. */
export function generateMockHotels(lat: number, lon: number, cityName: string): (typeof s.mockHotels.$inferInsert)[] {
  const key = areaKey(lat, lon);
  const r = createRng(hash(`hotels-${key}`));
  const used = new Set<number>();
  return Array.from({ length: 5 }, (_, i) => {
    let n = r.int(0, NAMES.length - 1);
    while (used.has(n)) n = (n + 1) % NAMES.length;
    used.add(n);
    const stars = [3, 3, 4, 4, 5][i];
    const base = { 3: 3500, 4: 6500, 5: 12000 }[stars as 3 | 4 | 5];
    return {
      id: r.uuid(), areaKey: key, cityName, name: `${NAMES[n]} ${cityName}`.slice(0, 80), stars,
      lat: Number((lat + (r.next() - 0.5) * 0.03).toFixed(6)), lon: Number((lon + (r.next() - 0.5) * 0.03).toFixed(6)),
      address: `Sample address near the centre of ${cityName}`, nightlyBaseInr: Math.round((base * (0.8 + r.next() * 0.5)) / 100) * 100,
    };
  });
}

/** Sample nightly rate for a date: weekends +10%, a small deterministic day-to-day wobble. */
function nightly(base: number, date: string, salt: string) {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const wobble = 0.95 + (hash(`${salt}-${date}`) % 1000) / 1000 * 0.15;
  return Math.round((base * (dow === 5 || dow === 6 ? 1.1 : 1) * wobble) / 50) * 50;
}

/** Sample hotel offers near a point for given dates: catalogue hotels for a known city, otherwise generated and stored ones. */
export async function mockHotelOffers(q: HotelQueryIn, dbIn?: Db): Promise<{ offers: PartnerHotelOffer[]; generated: boolean }> {
  const db = dbIn ?? (await getDb());
  const nights = nightsBetween(q.checkin, q.checkout);
  const rooms = Math.max(1, q.rooms);
  const dates = Array.from({ length: nights }, (_, i) => addDays(q.checkin, i));
  const markups = await loadMarkups(db, "hotel");
  const hotelsUrl = (p: PlatformId) => PLATFORMS[p].hotelsUrl;

  // known city: by slug, else the nearest seeded destination within 50 km
  const dests = await db.select({ id: s.destinations.id, slug: s.destinations.slug, lat: s.destinations.centerLat, lon: s.destinations.centerLon }).from(s.destinations);
  const dest = dests.find((d) => d.slug === q.citySlug) ?? dests.map((d) => ({ d, km: haversineKm(d, q) })).filter((x) => x.km <= 50).sort((a, b) => a.km - b.km)[0]?.d;

  type Base = { id: string; name: string; stars: number; lat: number; lon: number; address: string; perNight: number[] };
  let bases: Base[] = [];
  let generated = false;
  if (dest) {
    const hs = await db.select().from(s.hotels).where(eq(s.hotels.destinationId, dest.id));
    const inv = hs.length ? await db.select().from(s.roomInventory).where(and(inArray(s.roomInventory.hotelId, hs.map((h) => h.id)), eq(s.roomInventory.roomType, "standard"), gte(s.roomInventory.date, q.checkin), lt(s.roomInventory.date, q.checkout))) : [];
    bases = hs.map((h) => {
      const mine = inv.filter((x) => x.hotelId === h.id);
      if (mine.some((x) => x.roomsLeft < rooms)) return null; // sold out for this party on one of the nights
      return { id: h.id, name: h.name, stars: h.stars, lat: h.lat, lon: h.lon, address: h.address, perNight: dates.map((dt) => mine.find((x) => x.date === dt)?.priceInr ?? nightly(h.nightlyBaseInr, dt, h.id)) };
    }).filter((x): x is Base => !!x);
  } else {
    const key = areaKey(q.lat, q.lon);
    let rows = await db.select().from(s.mockHotels).where(eq(s.mockHotels.areaKey, key));
    if (!rows.length) {
      await db.insert(s.mockHotels).values(generateMockHotels(q.lat, q.lon, q.cityName)).onConflictDoNothing();
      rows = await db.select().from(s.mockHotels).where(eq(s.mockHotels.areaKey, key));
      generated = true;
    }
    bases = rows.map((h) => ({ id: h.id, name: h.name, stars: h.stars, lat: h.lat, lon: h.lon, address: h.address, perNight: dates.map((dt) => nightly(h.nightlyBaseInr, dt, h.id)) }));
  }

  const offers = bases.map((h): PartnerHotelOffer => {
    const total = h.perNight.reduce((a, x) => a + x, 0) * rooms;
    const refundable = h.stars >= 4;
    return {
      id: `mock:${h.id}:${q.checkin}:${nights}`, provider: "mock", providerLabel: SAMPLE_PROVIDER, source: SAMPLE_SOURCE,
      hotelName: h.name, address: h.address, lat: h.lat, lon: h.lon, roomType: `${h.stars}-star, standard room`,
      totalInr: total, perNightInr: Math.round(total / nights / rooms),
      breakup: [{ label: `Sample room rate (${nights} night${nights > 1 ? "s" : ""} × ${rooms} room${rooms > 1 ? "s" : ""})`, amountInr: total }],
      refundable, cancellation: refundable ? `Free cancellation until ${addDays(q.checkin, -2)} (sample policy)` : "Non-refundable (sample policy)",
      validUntil: new Date(Date.now() + 15 * 60_000).toISOString(),
      platformPrices: platformPricesFor(total, markups, hotelsUrl),
    };
  }).sort((a, b) => a.totalInr - b.totalInr);
  return { offers, generated };
}
