import type { FlightFacts, FlightProvider, FlightQuery, Offer } from "./types";

/**
 * Live flight prices from an OFFICIAL API: Amadeus for Developers (Self-Service Flight Offers Search). Enabled only when
 * AMADEUS_API_KEY and AMADEUS_API_SECRET are set (free keys at developers.amadeus.com). AMADEUS_ENV=test (default) uses their
 * test data, which is limited and not every route; AMADEUS_ENV=production needs Amadeus's production approval.
 * No scraping. Search only: booking happens on the traveller's own platform.
 */
const base = () => (process.env.AMADEUS_ENV === "production" ? "https://api.amadeus.com" : "https://test.api.amadeus.com");
let token: { value: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && token.exp > Date.now() + 30_000) return token.value;
  const res = await fetch(`${base()}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.AMADEUS_API_KEY!, client_secret: process.env.AMADEUS_API_SECRET! }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Amadeus sign-in ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.value;
}

type AmadeusOffer = {
  id: string;
  price: { currency: string; total: string; base: string };
  validatingAirlineCodes?: string[];
  itineraries: { duration?: string; segments: { carrierCode: string; number: string; departure: { iataCode: string; at: string }; arrival: { iataCode: string; at: string } }[] }[];
};
type AmadeusResponse = { data?: AmadeusOffer[]; dictionaries?: { carriers?: Record<string, string> } };

const minutes = (iso?: string) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(iso ?? ""); return m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : undefined; };

/** Pure mapping, exported for tests. */
export function mapAmadeus(j: AmadeusResponse, fxToInr = 1, pax = 1): Offer[] {
  const carriers = j.dictionaries?.carriers ?? {};
  return (j.data ?? []).map((o): Offer | null => {
    const it = o.itineraries[0];
    const segs = it?.segments ?? [];
    if (!segs.length) return null;
    const first = segs[0], last = segs[segs.length - 1];
    const cur = o.price.currency;
    const conv = (x: string) => Math.round(Number(x) * (cur === "INR" ? 1 : fxToInr));
    const total = conv(o.price.total), baseAmt = conv(o.price.base);
    const breakup = [{ label: `Base fare (${cur} ${o.price.base}, all ${pax} traveller${pax > 1 ? "s" : ""})`, amountInr: baseAmt }, { label: `Taxes and fees (${cur} ${(Number(o.price.total) - Number(o.price.base)).toFixed(2)})`, amountInr: total - baseAmt }];
    const carrier = carriers[first.carrierCode] ? carriers[first.carrierCode].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : first.carrierCode;
    const facts: FlightFacts = { carrier, flightNo: `${first.carrierCode}${first.number}`, from: first.departure.iataCode, to: last.arrival.iataCode, departLocal: first.departure.at.slice(0, 16), arriveLocal: last.arrival.at.slice(0, 16), stops: segs.length - 1, durationMin: minutes(it.duration) };
    return {
      id: `amadeus:${o.id}`, provider: "amadeus", kind: "flight", source: `Live price from Amadeus (${process.env.AMADEUS_ENV === "production" ? "production" : "test"} data), checked just now`,
      validUntil: new Date(Date.now() + 10 * 60_000).toISOString(), breakup, totalInr: total, refundable: false,
      summary: `${carrier} ${facts.flightNo}, ${facts.from} to ${facts.to}`, payload: o, facts,
    };
  }).filter((x): x is Offer => !!x);
}

export const AmadeusFlightProvider: FlightProvider = {
  name: "amadeus",
  enabled: () => !!process.env.AMADEUS_API_KEY && !!process.env.AMADEUS_API_SECRET,
  async search(q: FlightQuery): Promise<Offer[]> {
    if (!AmadeusFlightProvider.enabled()) return [];
    const params = new URLSearchParams({ originLocationCode: q.from, destinationLocationCode: q.to, departureDate: q.date, adults: String(Math.min(q.pax, 9)), currencyCode: "INR", max: "10" });
    const res = await fetch(`${base()}/v2/shopping/flight-offers?${params}`, { headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Amadeus ${res.status}`);
    return mapAmadeus((await res.json()) as AmadeusResponse, Number(process.env.FX_TO_INR ?? 1), q.pax);
  },
  async quote() { throw new Error("Search only: book on your own platform"); },
  async book() { throw new Error("Booking is done by the traveller on their own platform"); },
};
