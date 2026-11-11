import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { addDays, localDate, localDayRangeUtc, localTime } from "@/lib/time";
import { ORIGINS } from "@/lib/seed/data";

export type ItemDraft = {
  kind: "flight" | "hotel" | "transfer" | "activity";
  refId: string | null;
  date: string;
  details: Record<string, unknown>;
  priceInr: number;
};

export type TripPlan = {
  itinerary: typeof s.itineraries.$inferSelect;
  cities: (typeof s.destinations.$inferSelect)[];
  startDate: string;
  endDate: string;
  pax: number;
  items: ItemDraft[];
  breakdown: { label: string; amountInr: number }[];
  totalInr: number;
  warnings: string[];
};

export function nightsSplit(nights: number, cities: number): number[] {
  return cities === 1 ? [nights] : [Math.ceil(nights / 2), nights - Math.ceil(nights / 2)];
}

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Pick the flight on a route whose local time at `anchor` ("arrive" or "depart") is closest to `target`. */
async function pickFlight(
  db: Db, from: string, to: string, date: string, anchor: "arrive" | "depart", tz: string, target: string, pax: number,
): Promise<typeof s.flights.$inferSelect | null> {
  const [lo, hi] = localDayRangeUtc(date, tz);
  const col = anchor === "arrive" ? s.flights.arriveAt : s.flights.departAt;
  const rows = await db
    .select()
    .from(s.flights)
    .where(and(eq(s.flights.fromIata, from), eq(s.flights.toIata, to), gte(col, lo), lt(col, hi)))
    .orderBy(asc(s.flights.departAt));
  const ok = rows.filter((r) => r.seatsLeft >= pax);
  const pool = ok.length ? ok : rows;
  if (!pool.length) return null;
  return pool
    .map((r) => ({ r, d: Math.abs(mins(localTime(anchor === "arrive" ? r.arriveAt : r.departAt, tz)) - mins(target)) }))
    .sort((a, b) => a.d - b.d)[0].r;
}

export function flightDetails(f: typeof s.flights.$inferSelect, pax: number, leg: string, pnr?: string): Record<string, unknown> {
  return {
    flightId: f.id, flightNo: f.flightNo, carrierName: f.carrierName, from: f.fromIata, to: f.toIata,
    departAt: f.departAt.toISOString(), arriveAt: f.arriveAt.toISOString(), farePerPaxInr: f.fareInr, pax, leg,
    pnr: pnr ?? `SSP${f.flightNo.slice(2)}`, changeFeeInr: f.changeFeeInr, fareRules: f.fareRules,
  };
}

/** Resolve a trip for an itinerary + arrival date + pax into priced booking items (no writes). */
export async function planTrip(slug: string, startDate: string, pax: number, dbIn?: Db): Promise<TripPlan | null> {
  const db = dbIn ?? (await getDb());
  const [itinerary] = await db.select().from(s.itineraries).where(eq(s.itineraries.slug, slug)).limit(1);
  if (!itinerary) return null;
  const cityRows = await db.select().from(s.destinations).where(inArray(s.destinations.slug, itinerary.cities));
  const cities = itinerary.cities.map((c) => cityRows.find((r) => r.slug === c)!);
  const days = await db.select().from(s.itineraryDays).where(eq(s.itineraryDays.itineraryId, itinerary.id)).orderBy(asc(s.itineraryDays.dayNo));
  const per = nightsSplit(itinerary.nights, cities.length);
  const stars = itinerary.tier === "budget" ? 3 : itinerary.tier === "standard" ? 4 : 5;
  const actUnit = Math.round(1200 * (itinerary.tier === "budget" ? 0.7 : itinerary.tier === "standard" ? 1 : 1.8));
  const origin = ORIGINS[itinerary.originCity];
  const endDate = addDays(startDate, itinerary.nights);
  const rooms = Math.ceil(pax / 2);
  const items: ItemDraft[] = [];
  const warnings: string[] = [];

  // Flights
  const out = await pickFlight(db, itinerary.originCity, cities[0].airportIata, startDate, "arrive", cities[0].timezone, "10:00", pax);
  if (out) items.push({ kind: "flight", refId: out.id, date: localDate(out.departAt, origin.tz), details: flightDetails(out, pax, "outbound"), priceInr: out.fareInr * pax });
  else warnings.push(`No sample flight found for ${itinerary.originCity} to ${cities[0].airportIata} on ${startDate}.`);

  let cityStart = startDate;
  const hotelIds: string[] = [];
  const hotelsPerCity: (typeof s.hotels.$inferSelect)[] = [];
  for (let i = 0; i < cities.length; i++) {
    const hs = await db.select().from(s.hotels).where(and(eq(s.hotels.destinationId, cities[i].id), eq(s.hotels.stars, stars))).limit(1);
    hotelsPerCity.push(hs[0]);
    hotelIds.push(hs[0].id);
  }

  if (cities.length === 2) {
    const trDate = addDays(startDate, per[0]);
    const f = await pickFlight(db, cities[0].airportIata, cities[1].airportIata, trDate, "depart", cities[0].timezone, "11:30", pax);
    if (f) items.push({ kind: "flight", refId: f.id, date: trDate, details: flightDetails(f, pax, "intercity"), priceInr: f.fareInr * pax });
    else warnings.push(`No sample flight found for ${cities[0].airportIata} to ${cities[1].airportIata} on ${trDate}.`);
  }
  const ret = await pickFlight(db, cities[cities.length - 1].airportIata, itinerary.originCity, endDate, "depart", cities[cities.length - 1].timezone, "14:00", pax);
  if (ret) items.push({ kind: "flight", refId: ret.id, date: endDate, details: flightDetails(ret, pax, "return"), priceInr: ret.fareInr * pax });
  else warnings.push(`No sample return flight found on ${endDate}.`);

  // Hotels + transfers
  const xfers = await db.select().from(s.transfers).where(inArray(s.transfers.toPoiId, hotelIds));
  const xfersOut = await db.select().from(s.transfers).where(inArray(s.transfers.fromPoiId, hotelIds));
  const poiRows = await db.select().from(s.pois).where(inArray(s.pois.destinationId, cities.map((c) => c.id)));
  const poiName = (id: string) => poiRows.find((p) => p.id === id)?.name ?? "";
  for (let i = 0; i < cities.length; i++) {
    const h = hotelsPerCity[i];
    const nights = per[i];
    const checkout = addDays(cityStart, nights);
    const inv = await db
      .select()
      .from(s.roomInventory)
      .where(and(eq(s.roomInventory.hotelId, h.id), eq(s.roomInventory.roomType, "standard"), gte(s.roomInventory.date, cityStart), lt(s.roomInventory.date, checkout)));
    const rate = inv.length ? Math.round(inv.reduce((a, r) => a + r.priceInr, 0) / inv.length) : h.nightlyBaseInr;
    items.push({
      kind: "hotel", refId: h.id, date: cityStart,
      details: {
        hotelId: h.id, name: h.name, stars: h.stars, address: h.address, addressLocal: h.addressLocal, phone: h.phoneSample, lat: h.lat, lon: h.lon,
        checkinDate: cityStart, checkoutDate: checkout, nights, rooms, roomType: "standard", rateInr: rate,
        checkinTime: h.checkinTime, checkoutTime: h.checkoutTime, city: cities[i].slug, cityName: cities[i].name, rules: h.rules,
      },
      priceInr: rate * nights * rooms,
    });
    const pu = xfers.find((x) => x.toPoiId === h.id && x.type === "pickup");
    if (pu) {
      items.push({
        kind: "transfer", refId: pu.id, date: cityStart,
        details: { transferId: pu.id, type: "pickup", vendor: pu.vendorName, driver: pu.driverName, phone: pu.driverPhoneSample, pickupCode: pu.pickupCode, fromName: poiName(pu.fromPoiId), toName: h.name, fromPoiId: pu.fromPoiId, toPoiId: pu.toPoiId, city: cities[i].slug, time: "arrival + 60 min" },
        priceInr: 1800,
      });
    }
    const dr = xfersOut.find((x) => x.fromPoiId === h.id && x.type === "drop");
    if (dr) {
      items.push({
        kind: "transfer", refId: dr.id, date: checkout,
        details: { transferId: dr.id, type: "drop", vendor: dr.vendorName, driver: dr.driverName, phone: dr.driverPhoneSample, pickupCode: dr.pickupCode, fromName: h.name, toName: poiName(dr.toPoiId), fromPoiId: dr.fromPoiId, toPoiId: dr.toPoiId, city: cities[i].slug, time: "3 hours before flight" },
        priceInr: 1800,
      });
    }
    cityStart = checkout;
  }

  // Activities from the day plan
  for (const d of days) {
    const date = addDays(startDate, d.dayNo - 1);
    for (const it of d.items) {
      if (it.type !== "activity" || !it.poiId) continue;
      items.push({ kind: "activity", refId: it.poiId, date, details: { poiId: it.poiId, title: it.title, time: it.time, notes: it.notes ?? "", city: cities.find((c) => c.id === d.cityDestinationId)?.slug }, priceInr: actUnit * pax });
    }
  }

  const sum = (k: ItemDraft["kind"]) => items.filter((i) => i.kind === k).reduce((a, i) => a + i.priceInr, 0);
  const breakdown = [
    { label: "Flights", amountInr: sum("flight") },
    { label: "Hotels", amountInr: sum("hotel") },
    { label: "Airport transfers", amountInr: sum("transfer") },
    { label: "Activities", amountInr: sum("activity") },
  ];
  return { itinerary, cities, startDate, endDate, pax, items, breakdown, totalInr: breakdown.reduce((a, b) => a + b.amountInr, 0), warnings };
}

function randomRef() {
  return `SS-${Math.floor(10000 + Math.random() * 89999)}`;
}

export type CreateBookingInput = {
  userId: string;
  slug: string;
  startDate: string;
  pax: number;
  travellers: { name: string; ageBand: string; passportLast4?: string }[];
  ref?: string;
  /** "draft" = selected from the catalogue, not paid yet. The offline bundle is built for drafts too. */
  status?: "draft" | "confirmed";
};

export async function createBooking(input: CreateBookingInput, dbIn?: Db) {
  const db = dbIn ?? (await getDb());
  const plan = await planTrip(input.slug, input.startDate, input.pax, db);
  if (!plan) throw new Error("ITINERARY_NOT_FOUND");
  if (plan.warnings.length && plan.items.filter((i) => i.kind === "flight").length < 2) throw new Error(`NO_INVENTORY: ${plan.warnings.join(" ")}`);
  const ref = input.ref ?? randomRef();
  const booking = await db.transaction(async (tx) => {
    const [b] = await tx
      .insert(s.bookings)
      .values({ ref, userId: input.userId, itineraryId: plan.itinerary.id, startDate: plan.startDate, endDate: plan.endDate, pax: plan.pax, status: input.status ?? "confirmed", totalInr: plan.totalInr, packVersion: 0, insurancePhoneSample: "+00 000 000 0000" })
      .returning();
    if (plan.items.length) {
      await tx.insert(s.bookingItems).values(plan.items.map((i) => ({ bookingId: b.id, kind: i.kind, refId: i.refId, date: i.date, details: i.details, priceInr: i.priceInr, status: "confirmed" })));
    }
    if ((input.status ?? "confirmed") === "confirmed") await tx.insert(s.payments).values({ bookingId: b.id, method: "dummy", amountInr: plan.totalInr, status: "paid" });
    if (input.travellers.length) {
      await tx.insert(s.travellers).values(input.travellers.map((t) => ({ userId: input.userId, bookingId: b.id, name: t.name, ageBand: t.ageBand, passportLast4: t.passportLast4?.slice(-4) ?? null })));
    }
    await tx.insert(s.events).values({ name: (input.status ?? "confirmed") === "draft" ? "trip_selected" : "booking_created", userId: input.userId, bookingId: b.id, props: { ref, totalInr: plan.totalInr } });
    await tx.insert(s.tripDrafts).values({ userId: input.userId, itineraryId: plan.itinerary.id, bookingId: b.id, status: (input.status ?? "confirmed") === "draft" ? "preparing" : "booked" });
    return b;
  });
  return { booking, plan };
}
