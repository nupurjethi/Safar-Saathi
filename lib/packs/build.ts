import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { buildRoute, type SavedRoute } from "@/lib/map/routes";
import { resolveRules, type StoredRules } from "@/lib/rules/generate";
import { addDays, daysBetween, localDate, localTime } from "@/lib/time";
import { ORIGINS } from "@/lib/seed/data";
import { stableStringify } from "./hash";
import type { OfflinePack, PackDay, PackFlight, PackItem, PackManifest, PackManifestFile, PackMapCity, PackPlace, PackStay } from "./types";

type BaseContent = Omit<OfflinePack, "packVersion" | "contentHash" | "builtAt" | "rules" | "rulesMeta" | "ruleSet">;
type Content = Omit<OfflinePack, "packVersion" | "contentHash" | "builtAt">;

export const DISCLAIMER = "Predefined guidance from your booking. Not live information.";
export const PACK_BUDGET_BYTES = Number(process.env.PACK_BUDGET_MB ?? 80) * 1024 * 1024;

export { stableStringify };
export const sha256 = (x: string | Buffer) => `sha256:${createHash("sha256").update(x).digest("hex")}`;

type TilesManifest = Record<string, { bytes: number; hash: string; bbox?: [number, number, number, number] }>;
function readTilesManifest(): TilesManifest {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", "tiles", "manifest.json"), "utf8"));
  } catch {
    return {};
  }
}

/** Bounds from the PMTiles v3 header (min lon, min lat, max lon, max lat as int32 x 1e-7 at byte 102). */
function coreBbox(slug: string): [number, number, number, number] {
  const fd = fs.openSync(path.join(process.cwd(), "public", "tiles", `${slug}-core.pmtiles`), "r");
  try {
    const b = Buffer.alloc(127);
    fs.readSync(fd, b, 0, 127, 0);
    return [b.readInt32LE(102) / 1e7, b.readInt32LE(106) / 1e7, b.readInt32LE(110) / 1e7, b.readInt32LE(114) / 1e7];
  } finally { fs.closeSync(fd); }
}

/** Map files (overview + core PMTiles) for destinations, from public/tiles/manifest.json. Used by the pack and the pre-booking preview. */
export function mapCities(cities: { slug: string; name: string; bbox: [number, number, number, number]; centerLat: number; centerLon: number }[]): PackMapCity[] {
  const tiles = readTilesManifest();
  const tilesBase = process.env.TILES_BASE_URL ?? "/tiles";
  return cities.map((c) => ({
    id: c.slug, name: c.name, pmtiles: tiles[c.slug] ? `${tilesBase}/${c.slug}.pmtiles` : null, bytes: tiles[c.slug]?.bytes ?? 0,
    core: tiles[`${c.slug}-core`] ? { pmtiles: `${tilesBase}/${c.slug}-core.pmtiles`, bytes: tiles[`${c.slug}-core`].bytes, bbox: coreBbox(c.slug) } : null,
    bbox: c.bbox, center: [c.centerLat, c.centerLon] as [number, number],
  }));
}

const hm = (iso: string, tz: string) => localTime(new Date(iso), tz);
function shift(time: string, deltaMin: number) {
  const t = Math.max(0, Math.min(23 * 60 + 59, Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + deltaMin));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export async function buildPackContent(bookingId: string, dbIn?: Db): Promise<BaseContent> {
  const db = dbIn ?? (await getDb());
  const [b] = await db.select().from(s.bookings).where(eq(s.bookings.id, bookingId)).limit(1);
  if (!b) throw new Error("BOOKING_NOT_FOUND");
  const [itin] = await db.select().from(s.itineraries).where(eq(s.itineraries.id, b.itineraryId)).limit(1);
  const items = (await db.select().from(s.bookingItems).where(and(eq(s.bookingItems.bookingId, b.id), eq(s.bookingItems.status, "confirmed")))).sort(
    (x, y) => x.date.localeCompare(y.date),
  );
  const tpl = await db.select().from(s.itineraryDays).where(eq(s.itineraryDays.itineraryId, itin.id));
  const trav = await db.select().from(s.travellers).where(eq(s.travellers.bookingId, b.id));
  const cityRows = await db.select().from(s.destinations).where(inArray(s.destinations.slug, itin.cities));
  const cities = itin.cities.map((c) => cityRows.find((r) => r.slug === c)!);
  const pois = await db.select().from(s.pois).where(inArray(s.pois.destinationId, cities.map((c) => c.id)));
  const cityOfDestId = new Map(cities.map((c) => [c.id, c]));
  const origin = ORIGINS[itin.originCity];

  /* places */
  const places: Record<string, PackPlace> = {};
  const poiPlaceId = new Map<string, string>();
  for (const c of cities) {
    const ap = pois.find((p) => p.destinationId === c.id && p.category === "airport")!;
    places[`airport_${c.slug}`] = { id: `airport_${c.slug}`, kind: "airport", city: c.slug, name: ap.name, name_local: ap.nameLocal ?? ap.name, address: ap.address ?? ap.name, address_local: ap.addressLocal ?? ap.name, lat: ap.lat, lon: ap.lon };
    poiPlaceId.set(ap.id, `airport_${c.slug}`);
  }
  const hotelItems = items.filter((i) => i.kind === "hotel").sort((x, y) => String(x.details.checkinDate).localeCompare(String(y.details.checkinDate)));
  for (const hi of hotelItems) {
    const d = hi.details as Record<string, string | number>;
    const id = `hotel_${d.city}`;
    places[id] = { id, kind: "hotel", city: String(d.city), name: String(d.name), name_local: String(d.name), address: String(d.address), address_local: String(d.addressLocal), lat: Number(d.lat), lon: Number(d.lon), phone: String(d.phone) };
    if (hi.refId) poiPlaceId.set(hi.refId, id);
  }
  const actItems = items.filter((i) => i.kind === "activity");
  for (const ai of actItems) {
    const poi = pois.find((p) => p.id === ai.refId);
    if (!poi) continue;
    const id = `poi_${poi.id.slice(0, 8)}`;
    const cr = poi.imageCredit;
    places[id] = { id, kind: "poi", city: cityOfDestId.get(poi.destinationId)!.slug, name: poi.name, name_local: poi.nameLocal ?? poi.name, address: poi.address ?? poi.name, address_local: poi.addressLocal ?? poi.name, lat: poi.lat, lon: poi.lon, ...(poi.imageFile && cr ? { image: { src: poi.imageFile, title: cr.title, author: cr.author, license: cr.license, licenseUrl: cr.licenseUrl, sourceUrl: cr.sourceUrl } } : {}) };
    poiPlaceId.set(poi.id, id);
  }

  /* flights */
  const flightItems = items.filter((i) => i.kind === "flight");
  const iataTz = new Map<string, string>([[itin.originCity, origin.tz], ...cities.map((c) => [c.airportIata, c.timezone] as [string, string])]);
  const flights: PackFlight[] = flightItems
    .map((fi) => {
      const d = fi.details as Record<string, string>;
      return { leg: d.leg as PackFlight["leg"], flight_no: d.flightNo, carrier: d.carrierName, from: d.from, to: d.to, from_tz: iataTz.get(d.from) ?? "UTC", to_tz: iataTz.get(d.to) ?? "UTC", depart_at: d.departAt, arrive_at: d.arriveAt, pnr: d.pnr };
    })
    .sort((x, y) => x.depart_at.localeCompare(y.depart_at));

  /* stays */
  const stays: PackStay[] = hotelItems.map((hi) => {
    const d = hi.details as Record<string, string | number>;
    const c = cities.find((x) => x.slug === d.city)!;
    const pu = items.find((i) => i.kind === "transfer" && i.details.city === c.slug && i.details.type === "pickup");
    const dr = items.find((i) => i.kind === "transfer" && i.details.city === c.slug && i.details.type === "drop");
    const arr = flights.find((f) => f.to === c.airportIata && localDate(new Date(f.arrive_at), c.timezone) === String(d.checkinDate));
    const puDetails = (pu?.details ?? {}) as Record<string, string>;
    const drDetails = (dr?.details ?? {}) as Record<string, string>;
    return {
      city: c.slug, cityName: c.name, tz: c.timezone, from: String(d.checkinDate), to: String(d.checkoutDate),
      hotelId: `hotel_${c.slug}`, airportId: `airport_${c.slug}`, emergency: c.emergencyNumbers, consulate: c.consulate,
      driver: { name: puDetails.driver ?? "your driver", vendor: puDetails.vendor ?? "pickup vendor", phone: puDetails.phone ?? "", pickup_code: puDetails.pickupCode ?? "", pickup_time: arr ? `${hm(arr.arrive_at, c.timezone)} + 60 min` : "after you land" },
      dropDriver: { name: drDetails.driver ?? "your driver", vendor: drDetails.vendor ?? "pickup vendor", phone: drDetails.phone ?? "", pickup_code: drDetails.pickupCode ?? "" },
    };
  });

  /* days */
  const stayFor = (date: string) => [...stays].reverse().find((st) => st.from <= date) ?? stays[0];
  const days: PackDay[] = [];
  const total = daysBetween(b.startDate, b.endDate) + 1;
  for (let i = 0; i < total; i++) {
    const date = addDays(b.startDate, i);
    const st = stayFor(date);
    const t = tpl.find((x) => x.dayNo === i + 1);
    const list: PackItem[] = [];
    for (const f of flights) {
      if (f.leg === "outbound") {
        if (localDate(new Date(f.arrive_at), f.to_tz) === date)
          list.push({ time: hm(f.arrive_at, f.to_tz), type: "flight", title: `Land in ${st.cityName}: ${f.carrier} ${f.flight_no}`, notes: `Left ${f.from} ${hm(f.depart_at, f.from_tz)} (${f.from_tz === "Asia/Kolkata" ? "IST" : f.from_tz}). Booking code ${f.pnr}.` });
      } else if (localDate(new Date(f.depart_at), f.from_tz) === date) {
        list.push({ time: hm(f.depart_at, f.from_tz), type: "flight", title: `${f.carrier} ${f.flight_no}: ${f.from} to ${f.to}`, notes: `Lands ${hm(f.arrive_at, f.to_tz)} local. Booking code ${f.pnr}.` });
      }
    }
    for (const h of hotelItems) {
      const d = h.details as Record<string, string>;
      if (d.checkinDate === date) list.push({ time: d.checkinTime, type: "hotel", title: `Check in at ${d.name}`, placeId: `hotel_${d.city}` });
      if (d.checkoutDate === date) {
        const c = cities.find((q) => q.slug === d.city)!;
        const dep = flights.find((f) => f.from === c.airportIata && localDate(new Date(f.depart_at), c.timezone) === date);
        const ride = dep ? shift(hm(dep.depart_at, c.timezone), -210) : null;
        const normal = shift(d.checkoutTime, -60);
        list.push({ time: ride && ride < normal ? shift(ride, -20) : normal, type: "hotel", title: `Check out of ${d.name} (by ${d.checkoutTime})`, placeId: `hotel_${d.city}` });
      }
    }
    for (const x of items.filter((q) => q.kind === "transfer" && q.date === date)) {
      const d = x.details as Record<string, string>;
      const c = cities.find((q) => q.slug === d.city)!;
      if (d.type === "pickup") {
        const arr = flights.find((f) => f.to === c.airportIata && localDate(new Date(f.arrive_at), c.timezone) === date);
        list.push({ time: arr ? shift(hm(arr.arrive_at, c.timezone), 60) : "12:00", type: "transfer", title: `Pickup at ${d.fromName}`, notes: `Driver ${d.driver}, ${d.vendor}. Pickup code ${d.pickupCode}. To ${d.toName}.`, placeId: `airport_${c.slug}` });
      } else {
        const dep = flights.find((f) => f.from === c.airportIata && localDate(new Date(f.depart_at), c.timezone) === date);
        list.push({ time: dep ? shift(hm(dep.depart_at, c.timezone), -210) : "09:00", type: "transfer", title: `Ride to ${d.toName}`, notes: `Driver ${d.driver}, ${d.vendor}. Pickup code ${d.pickupCode}. Leave about 3.5 hours before your flight.`, placeId: `hotel_${c.slug}` });
      }
    }
    for (const a of actItems.filter((q) => q.date === date)) {
      const d = a.details as Record<string, string>;
      list.push({ time: d.time, type: "activity", title: d.title, notes: d.notes || undefined, placeId: a.refId ? poiPlaceId.get(a.refId) : undefined });
    }
    for (const m of t?.items.filter((q) => q.type === "meal") ?? []) list.push({ time: m.time, type: "meal", title: m.title });
    list.sort((x, y) => x.time.localeCompare(y.time));
    days.push({ date, dayNo: i + 1, city: st.city, cityName: st.cityName, tz: st.tz, title: t?.title ?? `Day ${i + 1}`, items: list });
  }

  /* routes (build-time routing; stored in the pack) */
  const routes: SavedRoute[] = [];
  const addRoute = async (fromId: string, toId: string, mode?: "drive" | "walk") => {
    const a = places[fromId], bb = places[toId];
    if (!a || !bb || routes.some((r) => r.from === fromId && r.to === toId)) return;
    routes.push(await buildRoute({ id: `${fromId}__${toId}`, from: fromId, to: toId, fromName: a.name, toName: bb.name }, a, bb, mode));
  };
  for (const st of stays) {
    await addRoute(st.airportId, st.hotelId, "drive");
    await addRoute(st.hotelId, st.airportId, "drive");
    for (const p of Object.values(places).filter((x) => x.kind === "poi" && x.city === st.city)) await addRoute(st.hotelId, p.id);
  }

  /* map + tiles */
  const map = {
    cities: mapCities(cities),
    style: "/map/style.json", glyphs: "/map/fonts/{fontstack}/{range}.pbf", sprite: "/map/sprites/light",
  };

  const flightsFirst = flightItems[0]?.details as Record<string, string> | undefined;
  return {
    booking: { ref: b.ref, status: b.status === "draft" ? "draft" : "confirmed", pax: b.pax, dates: [b.startDate, b.endDate], totalInr: b.totalInr, title: itin.title, origin: origin.city, travellers: trav.map((t) => t.name) },
    days, places, stays, flights,
    contacts: {
      airline: flightsFirst?.carrierName ?? "your airline", airline_phone: "+00 000 000 0000", insurance_phone: b.insurancePhoneSample ?? "+00 000 000 0000",
      sms_gateway: process.env.SMS_GATEWAY_NUMBER ?? "+000000000000", emergency: stays[0]?.emergency.general ?? "112",
      hotels: stays.map((st) => ({ city: st.cityName, name: places[st.hotelId].name, phone: places[st.hotelId].phone ?? "", address_local: places[st.hotelId].address_local })),
      sample: true,
    },
    routes, map, disclaimer: DISCLAIMER,
  };
}

function listFiles(dir: string, base: string): { url: string; abs: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(abs, `${base}/${e.name}`) : [{ url: `${base}/${e.name}`, abs }];
  });
}

export function buildManifest(pack: OfflinePack, bookingId: string, packBytes: number): PackManifest {
  const files: PackManifestFile[] = [{ url: `/api/packs/${bookingId}/pack?v=${pack.packVersion}`, kind: "pack", bytes: packBytes, hash: pack.contentHash }];
  const tiles = readTilesManifest();
  for (const c of pack.map.cities) {
    if (c.pmtiles) files.push({ url: c.pmtiles, kind: "tiles", bytes: c.bytes, hash: tiles[c.id]?.hash });
    if (c.core) files.push({ url: c.core.pmtiles, kind: "tiles", bytes: c.core.bytes, hash: tiles[`${c.id}-core`]?.hash });
  }
  for (const place of Object.values(pack.places)) {
    if (!place.image) continue;
    try {
      const buf = fs.readFileSync(path.join(process.cwd(), "public", place.image.src));
      files.push({ url: place.image.src, kind: "image", bytes: buf.length, hash: sha256(buf) });
    } catch { /* image file missing on disk: the UI falls back to gradient art */ }
  }
  for (const f of listFiles(path.join(process.cwd(), "public", "map"), "/map")) {
    const buf = fs.readFileSync(f.abs);
    files.push({ url: f.url, kind: "map-asset", bytes: buf.length, hash: sha256(buf) });
  }
  const ref = pack.booking.ref;
  for (const p of ["", "/chat", "/guide", "/map", "/sos", "/log"]) files.push({ url: `/trips/${ref}${p}`, kind: "page", bytes: 0 });
  files.push({ url: "/offline", kind: "page", bytes: 0 });
  const totalBytes = files.reduce((a, f) => a + f.bytes, 0);
  return { bookingRef: ref, packVersion: pack.packVersion, contentHash: pack.contentHash, builtAt: pack.builtAt, totalBytes, budgetBytes: PACK_BUDGET_BYTES, overBudget: totalBytes > PACK_BUDGET_BYTES, files };
}

export type PublishResult = { version: number; changed: boolean; manifest: PackManifest; regenerated: string[]; rulesOrigin: string };

/**
 * Build the pack for a trip and store it as the next version (no-op if nothing changed).
 * Rules are drafted/validated here (lib/rules/generate.ts): only scenarios whose facts changed are redrafted,
 * and an invalid rule set is never stored. The previous version stays active until this insert succeeds.
 */
export async function publishPack(bookingId: string, dbIn?: Db, opts: { change?: string } = {}): Promise<PublishResult> {
  const db = dbIn ?? (await getDb());
  const base = await buildPackContent(bookingId, db);
  const [last] = await db.select().from(s.offlinePacks).where(eq(s.offlinePacks.bookingId, bookingId)).orderBy(desc(s.offlinePacks.version)).limit(1);
  const lastPack = last?.pack as OfflinePack | undefined;
  const prev: StoredRules | null = lastPack?.ruleSet && lastPack.rulesMeta ? { ruleSet: lastPack.ruleSet, meta: lastPack.rulesMeta } : null;
  const rules = await resolveRules(base, base.booking.ref, prev);
  const content: Content = { ...base, rules: rules.engine, rulesMeta: rules.stored.meta, ruleSet: rules.stored.ruleSet };
  const contentHash = sha256(stableStringify(content));
  if (last && last.contentHash === contentHash) return { version: last.version, changed: false, manifest: last.manifest as PackManifest, regenerated: [], rulesOrigin: rules.stored.meta.origin };
  const version = (last?.version ?? 0) + 1;
  const pack: OfflinePack = { packVersion: version, contentHash, builtAt: new Date().toISOString(), ...content };
  const packBytes = Buffer.byteLength(JSON.stringify(pack));
  const manifest = buildManifest(pack, bookingId, packBytes);
  await db.transaction(async (tx0) => {
    const tx = tx0 as unknown as Db;
    await tx.update(s.offlinePacks).set({ status: "superseded" }).where(eq(s.offlinePacks.bookingId, bookingId));
    await tx.insert(s.offlinePacks).values({ bookingId, version, contentHash, sizeBytes: manifest.totalBytes, status: "active", manifest, pack });
    await tx.insert(s.tripVersions).values({ bookingId, version, change: opts.change ?? (version === 1 ? "Trip selected" : "Trip updated"), dataHash: rules.stored.meta.sourceHash });
    await tx.update(s.ruleSets).set({ status: "validated" }).where(and(eq(s.ruleSets.bookingId, bookingId), eq(s.ruleSets.status, "active")));
    const [rsRow] = await tx.insert(s.ruleSets).values({ bookingId, tripVersion: version, schemaVersion: 1, sourceHash: rules.stored.meta.sourceHash, status: "active", origin: rules.stored.meta.origin, generatedBy: { model: rules.stored.meta.model, promptVersion: rules.stored.meta.promptVersion, regenerated: rules.regenerated, failures: rules.stored.meta.failures }, content: rules.stored.ruleSet }).returning({ id: s.ruleSets.id });
    const checks = rules.checks.length ? rules.checks : [{ check: "reused", passed: true, detail: "Stored rule set reused; nothing it is built on changed" }];
    await tx.insert(s.ruleValidations).values(checks.map((c) => ({ ruleSetId: rsRow.id, check: c.check, passed: c.passed, detail: c.detail })));
    await tx.update(s.bookings).set({ packVersion: version, updatedAt: new Date() }).where(eq(s.bookings.id, bookingId));
  });
  return { version, changed: true, manifest, regenerated: rules.regenerated, rulesOrigin: rules.stored.meta.origin };
}

export async function getLatestPack(bookingId: string, dbIn?: Db) {
  const db = dbIn ?? (await getDb());
  const [row] = await db.select().from(s.offlinePacks).where(eq(s.offlinePacks.bookingId, bookingId)).orderBy(desc(s.offlinePacks.version)).limit(1);
  return row ?? null;
}
