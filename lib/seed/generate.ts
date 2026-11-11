import type { InferInsertModel } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import { bboxOf, haversineKm } from "@/lib/geo";
import { createRng, type Rng } from "@/lib/rng";
import { addDays, tzOffsetForDay } from "@/lib/time";
import placeImages from "./place-images.json";
import {
  CARRIERS, COMBOS, DESTINATIONS, HERO_PALETTES, ORIGINS, ORIGIN_CODES, THEME_TITLES,
  type DestSeed, type Theme,
} from "./data";

export type SeedOptions = { seed?: number; baseDate: string; flightDays?: number };

export type SeedData = {
  destinations: InferInsertModel<typeof s.destinations>[];
  pois: InferInsertModel<typeof s.pois>[];
  itineraries: InferInsertModel<typeof s.itineraries>[];
  itineraryDays: InferInsertModel<typeof s.itineraryDays>[];
  flights: InferInsertModel<typeof s.flights>[];
  hotels: InferInsertModel<typeof s.hotels>[];
  roomInventory: InferInsertModel<typeof s.roomInventory>[];
  transfers: InferInsertModel<typeof s.transfers>[];
};

type PlaceImg = { file: string; title: string; author: string; license: string; licenseUrl: string; sourceUrl: string; pageUrl: string };
const IMAGES = placeImages as Record<string, PlaceImg>;
const credit = (i?: PlaceImg) => (i ? { title: i.title, author: i.author, license: i.license, licenseUrl: i.licenseUrl, sourceUrl: i.sourceUrl, pageUrl: i.pageUrl } : null);

type Tier = "budget" | "standard" | "premium";
const TIERS: Record<Tier, { stars: 3 | 4 | 5; hotelMult: number; actMult: number }> = {
  budget: { stars: 3, hotelMult: 0.6, actMult: 0.7 },
  standard: { stars: 4, hotelMult: 1, actMult: 1 },
  premium: { stars: 5, hotelMult: 1.9, actMult: 1.8 },
};
/** Keeps sample room rates modest so a one-night extension for a family stays under the default ₹25,000 gate limit. */
const COST_SCALE = 0.6;
const SAMPLE_PHONE = "+00 000 000 0000";
const HOTEL_NAMES = [
  "Harbour View Residency", "Grand Meridian", "Lotus Court", "Atlas Boutique Hotel", "The Saffron House",
  "Cedar & Stone Hotel", "Aurora Palace", "Willow Square Inn", "Monsoon Terrace", "The Lantern Hotel",
];
const STATION_RE = /Termini|Gare |Hauptbahnhof|Centraal|King's Cross|Ferry Pier|Star Ferry|Port de la/;

type ItinSpec = { cities: string[]; theme: Theme; tier: Tier; nights: number; origin: string; slug: string };

export function planItineraries(rng: Rng): ItinSpec[] {
  const specs: ItinSpec[] = [];
  const tierPlan: Tier[] = ["budget", "standard", "standard", "premium"];
  for (const d of DESTINATIONS) {
    if (d.slug === "bangalore") continue; // its two itineraries are explicit entries in COMBOS (domestic, 3 nights)
    const nightsPool = [4, 5, 6, 7, 8].sort(() => rng.next() - 0.5);
    tierPlan.forEach((tier, i) => {
      const theme = d.themes[i % d.themes.length];
      const nights = nightsPool[i];
      const origin = rng.pick(ORIGIN_CODES);
      specs.push({ cities: [d.slug], theme, tier, nights, origin, slug: `${d.slug}-${nights}n-${tier}-${theme}` });
    });
  }
  for (const c of COMBOS) {
    specs.push({
      cities: c.cities, theme: c.theme, tier: c.tier, nights: c.nights, origin: c.origin,
      slug: c.slugOverride ?? `${c.cities.join("-")}-${c.nights}n-${c.tier}-${c.theme}`,
    });
  }
  return specs;
}

export function generateSeed(opts: SeedOptions): SeedData {
  const rng = createRng(opts.seed ?? 20261110);
  /** Bangalore draws from its OWN stream so adding it did not change any value generated for the other 25 destinations. */
  const brng = createRng((opts.seed ?? 20261110) + 7919);
  const isBlr = (slug: string) => slug === "bangalore";
  const flightDays = opts.flightDays ?? 120;
  const out: SeedData = { destinations: [], pois: [], itineraries: [], itineraryDays: [], flights: [], hotels: [], roomInventory: [], transfers: [] };

  /* ---- destinations, pois, hotels, transfers ---- */
  const destId = new Map<string, string>();
  const airportPoi = new Map<string, string>();
  const hotelsByDest = new Map<string, { id: string; stars: number; nightly: number; name: string; lat: number; lon: number }[]>();
  const sightsByDest = new Map<string, { id: string; name: string }[]>();

  for (const d of DESTINATIONS) {
    const r = isBlr(d.slug) ? brng : rng;
    const id = r.uuid();
    destId.set(d.slug, id);
    const sights = d.pois.filter((x) => !STATION_RE.test(x.name));
    const allPts = [{ lat: d.airport.lat, lon: d.airport.lon }, ...d.pois.map((x) => ({ lat: x.lat, lon: x.lon }))];
    out.destinations.push({
      id, slug: d.slug, name: d.name, country: d.country, iso2: d.iso2, currency: d.currency, timezone: d.timezone,
      centerLat: d.center[0], centerLon: d.center[1], airportIata: d.iata,
      bbox: bboxOf(allPts, 0.04).map((n) => Math.round(n * 1e4) / 1e4) as [number, number, number, number],
      pmtilesUrl: null,
      heroImage: IMAGES[`${d.slug}/${d.pois.find((p) => IMAGES[`${d.slug}/${p.name}`])?.name}`]?.file ?? null,
      heroCredit: credit(IMAGES[`${d.slug}/${d.pois.find((p) => IMAGES[`${d.slug}/${p.name}`])?.name}`]),
      emergencyNumbers: d.emergency,
      consulate: d.iso2 === "IN"
        ? { name: `No consulate needed in India: tourist helpline, ${d.name} (sample contact)`, address: `Sample address, ${d.name}, ${d.country}`, phone: SAMPLE_PHONE, sample: true }
        : { name: `Indian consular services, ${d.name} (sample contact)`, address: `Sample address, ${d.name}, ${d.country}`, phone: SAMPLE_PHONE, sample: true },
    });

    const apId = r.uuid();
    airportPoi.set(d.slug, apId);
    out.pois.push({ id: apId, destinationId: id, name: d.airport.name, nameLocal: d.airport.local, category: "airport", lat: d.airport.lat, lon: d.airport.lon, address: d.airport.name, addressLocal: d.airport.local });
    const sightList: { id: string; name: string }[] = [];
    for (const poi of d.pois) {
      const pid = r.uuid();
      const cat = STATION_RE.test(poi.name) ? "station" : "sight";
      out.pois.push({ id: pid, destinationId: id, name: poi.name, nameLocal: poi.local, category: cat, lat: poi.lat, lon: poi.lon, address: `${poi.name}, ${d.name}`, addressLocal: `${poi.local}, ${d.localCity}`, imageFile: IMAGES[`${d.slug}/${poi.name}`]?.file ?? null, imageCredit: credit(IMAGES[`${d.slug}/${poi.name}`]) });
      if (cat === "sight") sightList.push({ id: pid, name: poi.name });
    }
    sightsByDest.set(d.slug, sightList);
    void sights;

    const latin = /^[\x00-ɏ\s,.'\-0-9]+$/.test(d.localStreet);
    const hs: { id: string; stars: number; nightly: number; name: string; lat: number; lon: number }[] = [];
    ([3, 4, 5] as const).forEach((stars, i) => {
      const hid = r.uuid();
      const anchor = d.hotelAnchors?.[i] ?? d.pois[i % d.pois.length];
      const lat = anchor.lat + (r.next() - 0.5) * 0.006;
      const lon = anchor.lon + (r.next() - 0.5) * 0.006;
      const num = r.int(3, 98);
      const name = `${HOTEL_NAMES[(r.int(0, 99) + i * 3) % HOTEL_NAMES.length]} ${d.name.split(" (")[0]}`;
      const tierMult = stars === 3 ? 0.6 : stars === 4 ? 1 : 1.9;
      const nightly = Math.round((d.cost * COST_SCALE * tierMult) / 100) * 100;
      const address = latin ? `${num} ${d.localStreet}, ${d.name.split(" (")[0]}` : `No. ${num}, Central District, ${d.name.split(" (")[0]}`;
      const addressLocal = `${d.localStreet} ${num}, ${d.localCity}`;
      out.pois.push({ id: hid, destinationId: id, name, nameLocal: name, category: "hotel", lat, lon, address, addressLocal });
      out.hotels.push({
        id: hid, destinationId: id, name, stars, lat, lon, address, addressLocal, phoneSample: SAMPLE_PHONE,
        checkinTime: stars === 5 ? "15:00" : "14:00", checkoutTime: stars === 3 ? "11:00" : "12:00",
        rules: ["Passport needed at check-in", "Quiet hours 22:00 to 07:00", "Late arrival? Call the hotel (sample number)"], nightlyBaseInr: nightly,
      });
      hs.push({ id: hid, stars, nightly, name, lat, lon });

      out.transfers.push(
        { id: r.uuid(), destinationId: id, type: "pickup", fromPoiId: apId, toPoiId: hid, vendorName: "Kesari Cabs (sample)", driverName: r.pick(["Ravi", "Marco", "Ahmed", "Somchai", "Luca", "Nguyen", "Kenji"]), driverPhoneSample: SAMPLE_PHONE, pickupCode: `SS${r.int(1000, 9999)}` },
        { id: r.uuid(), destinationId: id, type: "drop", fromPoiId: hid, toPoiId: apId, vendorName: "Kesari Cabs (sample)", driverName: r.pick(["Priya", "Elena", "Omar", "Anan", "Sofia", "Linh", "Aiko"]), driverPhoneSample: SAMPLE_PHONE, pickupCode: `SS${r.int(1000, 9999)}` },
      );
    });
    hotelsByDest.set(d.slug, hs);
  }

  /* ---- room inventory ---- */
  const invDays = flightDays + 10;
  const blrDestId = out.destinations.find((d) => isBlr(d.slug))!.id;
  for (const h of out.hotels) {
    const r = h.destinationId === blrDestId ? brng : rng;
    for (let i = 0; i < invDays; i++) {
      const date = addDays(opts.baseDate, i);
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      const weekend = dow === 5 || dow === 6 ? 1.1 : 1;
      const price = Math.round((h.nightlyBaseInr * weekend * (0.9 + r.next() * 0.25)) / 50) * 50;
      out.roomInventory.push({ hotelId: h.id, date, roomType: "standard", priceInr: price, roomsLeft: r.int(0, 9) });
      out.roomInventory.push({ hotelId: h.id, date, roomType: "deluxe", priceInr: Math.round((price * 1.35) / 50) * 50, roomsLeft: r.int(0, 6) });
    }
  }

  /* ---- itineraries + days ---- */
  const specs = planItineraries(rng);
  const destBySlug = new Map(DESTINATIONS.map((d) => [d.slug, d]));
  const routes = new Set<string>();
  const blrRoutes = new Set<string>(); // routes used only by the Bangalore demo trips
  const iataOf = (slug: string) => destBySlug.get(slug)!.iata;

  for (const sp of specs) {
    const r = isBlr(sp.cities[0]) ? brng : rng;
    const ds = sp.cities.map((c) => destBySlug.get(c)!);
    const t = TIERS[sp.tier];
    // route bookkeeping
    const rset = isBlr(sp.cities[0]) ? blrRoutes : routes;
    rset.add(`${sp.origin}>${iataOf(sp.cities[0])}`);
    for (let i = 0; i < sp.cities.length - 1; i++) rset.add(`${iataOf(sp.cities[i])}>${iataOf(sp.cities[i + 1])}`);
    rset.add(`${iataOf(sp.cities[sp.cities.length - 1])}>${sp.origin}`);

    // nights per city
    const per: number[] = sp.cities.length === 1 ? [sp.nights] : [Math.ceil(sp.nights / 2), sp.nights - Math.ceil(sp.nights / 2)];
    const itinId = r.uuid();
    const cityNames = ds.map((d) => d.name.split(" (")[0]);
    const isDemo = sp.slug === "paris-rome-classic-7n";
    const title = isDemo ? "Paris & Rome Classic" : `${cityNames.join(" & ")}: ${r.pick(THEME_TITLES[sp.theme])}`;

    // price per person estimate
    const o = ORIGINS[sp.origin];
    const legs: [{ lat: number; lon: number }, { lat: number; lon: number }][] = [];
    const pts = [o, ...ds.map((d) => ({ lat: d.airport.lat, lon: d.airport.lon })), o];
    for (let i = 0; i < pts.length - 1; i++) legs.push([pts[i], pts[i + 1]]);
    const flightPp = legs.reduce((acc, [a, b]) => acc + haversineKm(a, b) * 4.2 + 3000, 0);
    const hotelPp = ds.reduce((acc, d, i) => acc + (per[i] * d.cost * COST_SCALE * t.hotelMult) / 2, 0);
    const actPp = (sp.nights + 1) * 2200 * t.actMult;
    const xferPp = 3600 + (ds.length - 1) * 1500;
    const pricePp = Math.round((flightPp + hotelPp + actPp + xferPp) / 500) * 500;
    const palettePool = HERO_PALETTES[ds[0].region];

    out.itineraries.push({
      id: itinId, slug: sp.slug, title, theme: sp.theme, tier: sp.tier, nights: sp.nights, originCity: sp.origin,
      cities: sp.cities, pricePerPersonInr: pricePp, ratingSample: Math.round((3.9 + r.next() * 1) * 10) / 10,
      heroPalette: r.pick(palettePool), tags: [sp.theme, sp.tier, ds[0].region, `${sp.nights}n`, ...new Set(ds.map((d) => d.country))],
      summary: `${sp.nights} nights across ${cityNames.join(" and ")}. ${sp.tier[0].toUpperCase() + sp.tier.slice(1)} stays, airport transfers and a ${sp.theme}-style day plan. Sample itinerary.`,
    });

    // days
    const totalDays = sp.nights + 1;
    const cityOfDay: number[] = [];
    let cum = 0;
    per.forEach((n, ci) => {
      for (let k = 0; k < n; k++) cityOfDay.push(ci);
      cum += n;
      void cum;
    });
    cityOfDay.push(per.length - 1); // departure day stays in the last city
    // transition day: first day after leaving city 0 belongs to city 1 (arrive same day)
    if (per.length === 2) {
      cityOfDay.length = 0;
      for (let d = 1; d <= totalDays; d++) cityOfDay.push(d <= per[0] ? 0 : 1);
    }
    const used = new Map<number, number>();
    for (let day = 1; day <= totalDays; day++) {
      const ci = cityOfDay[day - 1];
      const d = ds[ci];
      const dId = destId.get(d.slug)!;
      const sights = sightsByDest.get(d.slug)!;
      const hotel = hotelsByDest.get(d.slug)!.find((h) => h.stars === t.stars)!;
      const nextSight = () => {
        const n = used.get(ci) ?? 0;
        used.set(ci, n + 1);
        return sights[n % sights.length];
      };
      const items: s.DayItem[] = [];
      const first = day === 1;
      const last = day === totalDays;
      const transition = per.length === 2 && day === per[0] + 1;
      if (first) {
        items.push({ time: "09:30", type: "flight", title: `Arrive in ${cityNames[ci]} (flight time from your booking)` });
        items.push({ time: "11:00", type: "transfer", poiId: airportPoi.get(d.slug), title: `Airport pickup to ${hotel.name}`, notes: "Look for the driver with your pickup code." });
        items.push({ time: "14:00", type: "hotel", poiId: hotel.id, title: `Check in at ${hotel.name}` });
        const sg = nextSight();
        items.push({ time: "17:00", type: "activity", poiId: sg.id, title: `Easy first evening: ${sg.name}`, notes: "Stay close to the hotel on day one." });
      } else if (last) {
        items.push({ time: "10:00", type: "hotel", poiId: hotel.id, title: `Check out of ${hotel.name}` });
        items.push({ time: "11:00", type: "transfer", poiId: hotel.id, title: "Transfer to the airport", notes: "Leave at least 3 hours before your flight." });
        items.push({ time: "14:00", type: "flight", title: `Fly home to ${o.city} (flight time from your booking)` });
      } else if (transition) {
        const prev = ds[0];
        const prevHotel = hotelsByDest.get(prev.slug)!.find((h) => h.stars === t.stars)!;
        items.push({ time: "08:00", type: "hotel", poiId: prevHotel.id, title: `Check out of ${prevHotel.name}` });
        items.push({ time: "09:00", type: "transfer", poiId: prevHotel.id, title: `Transfer to ${prev.name} airport` });
        items.push({ time: "11:30", type: "flight", title: `Fly ${cityNames[0]} to ${cityNames[1]} (flight time from your booking)` });
        items.push({ time: "15:00", type: "transfer", poiId: airportPoi.get(d.slug), title: `Airport pickup to ${hotel.name}` });
        items.push({ time: "16:30", type: "hotel", poiId: hotel.id, title: `Check in at ${hotel.name}` });
      } else {
        const a = nextSight();
        const b = nextSight();
        items.push({ time: "09:30", type: "activity", poiId: a.id, title: a.name, notes: sp.theme === "adventure" ? "Wear comfortable shoes." : "Book entry in advance where needed (sample note)." });
        items.push({ time: "13:00", type: "meal", title: `Lunch near ${a.name}` });
        items.push({ time: "15:30", type: "activity", poiId: b.id, title: b.name });
      }
      out.itineraryDays.push({
        id: r.uuid(), itineraryId: itinId, dayNo: day, cityDestinationId: dId,
        title: first ? `Arrive in ${cityNames[ci]}` : last ? "Head home" : transition ? `${cityNames[0]} to ${cityNames[1]}` : `${cityNames[ci]}: day ${day}`,
        items,
      });
    }
  }

  /* ---- flights ---- */
  const durationMin = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.round(45 + (haversineKm(a, b) / 800) * 60);
  const airportCoord = new Map<string, { lat: number; lon: number; tz: string }>();
  for (const [k, v] of Object.entries(ORIGINS)) airportCoord.set(k, { lat: v.lat, lon: v.lon, tz: v.tz });
  for (const d of DESTINATIONS) airportCoord.set(d.iata, { lat: d.airport.lat, lon: d.airport.lon, tz: d.timezone });

  const horizon = flightDays + 10;
  const genRoutes = (list: string[], r: Rng) => { for (const route of list) {
    const [from, to] = route.split(">");
    const a = airportCoord.get(from)!;
    const b = airportCoord.get(to)!;
    const dist = haversineKm(a, b);
    const dur = durationMin(a, b);
    for (let i = 0; i < horizon; i++) {
      const date = addDays(opts.baseDate, i);
      const count = r.int(3, 5);
      for (let k = 0; k < count; k++) {
        let departUtcMs: number;
        if (k === 0) {
          // guaranteed "morning arrival" option for date D at the destination
          const arrMin = r.int(7 * 12, 11 * 12) * 5;
          const arrLocalMs = Date.parse(`${date}T00:00:00Z`) + arrMin * 60000;
          const arrUtcMs = arrLocalMs - tzOffsetForDay(date, b.tz) * 60000;
          departUtcMs = arrUtcMs - dur * 60000;
        } else {
          const depMin = r.int(0, 23 * 12 + 11) * 5;
          const depLocalMs = Date.parse(`${date}T00:00:00Z`) + depMin * 60000;
          departUtcMs = depLocalMs - tzOffsetForDay(date, a.tz) * 60000;
        }
        const carrier = r.pick(CARRIERS);
        const urgency = 1 + 0.25 * (1 - i / horizon);
        const fare = Math.round((dist * (3.8 + r.next() * 1.2) + 2500) * urgency / 50) * 50;
        const changeFee = r.int(2, 5) * 500;
        out.flights.push({
          id: r.uuid(), flightNo: `${carrier.code}${r.int(100, 989)}`, carrierName: carrier.name, fromIata: from, toIata: to,
          departAt: new Date(departUtcMs), arriveAt: new Date(departUtcMs + dur * 60000), fareInr: fare, seatsLeft: r.int(1, 12),
          changeFeeInr: changeFee,
          fareRules: { changeAllowed: true, changeFeeInr: changeFee, fareDifferenceApplies: true, notes: "Sample fare rules: change fee plus any fare difference applies. Changes are not allowed within 3 hours of departure." },
        });
      }
    }
  } }; // end genRoutes
  genRoutes([...routes].sort(), rng);
  genRoutes([...blrRoutes].sort(), brng);
  return out;
}

export function destBySlug(slug: string): DestSeed | undefined {
  return DESTINATIONS.find((d) => d.slug === slug);
}
