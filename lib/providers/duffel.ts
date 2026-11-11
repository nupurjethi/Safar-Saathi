import type { FlightFacts, FlightProvider, FlightQuery, Offer } from "./types";

/**
 * Optional real provider through an OFFICIAL API (Duffel), enabled only when DUFFEL_API_KEY is set and the
 * user's agreement with Duffel permits it. No scraping. STUB: written against Duffel's documented offer-request
 * endpoint but NOT exercised without a key. Amounts are converted with FX_TO_INR (default: INR only).
 * Booking is intentionally not wired: a live option still needs a Confirm tap, and booking is outside this prototype.
 */
export const DuffelFlightProvider: FlightProvider = {
  name: "duffel",
  enabled: () => !!process.env.DUFFEL_API_KEY,
  async search(q: FlightQuery): Promise<Offer[]> {
    const key = process.env.DUFFEL_API_KEY;
    if (!key) return [];
    const res = await fetch("https://api.duffel.com/air/offer_requests?return_offers=true", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Duffel-Version": "v2", "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ data: { slices: [{ origin: q.from, destination: q.to, departure_date: q.date }], passengers: Array.from({ length: q.pax }, () => ({ type: "adult" })), cabin_class: "economy" } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Duffel ${res.status}`);
    const j = (await res.json()) as { data?: { offers?: { id: string; total_amount: string; base_amount: string; tax_amount: string; total_currency: string; expires_at: string; owner?: { name?: string }; slices?: { duration?: string; segments?: { marketing_carrier_flight_number?: string; marketing_carrier?: { iata_code?: string }; origin?: { iata_code?: string }; destination?: { iata_code?: string }; departing_at?: string; arriving_at?: string }[] }[] }[] } };
    const fx = Number(process.env.FX_TO_INR ?? 1);
    return (j.data?.offers ?? []).slice(0, 5).map((o): Offer => {
      const cur = o.total_currency;
      const conv = (x: string) => Math.round(Number(x) * (cur === "INR" ? 1 : fx));
      const breakup = [{ label: `Base fare (${cur} ${o.base_amount})`, amountInr: conv(o.base_amount) }, { label: `Taxes and fees (${cur} ${o.tax_amount})`, amountInr: conv(o.tax_amount) }];
      return { id: o.id, provider: "duffel", kind: "flight", source: `Live price from Duffel, valid until ${o.expires_at}`, validUntil: o.expires_at, breakup, totalInr: breakup.reduce((a, l) => a + l.amountInr, 0), refundable: false, summary: `${o.owner?.name ?? "Airline"} ${o.slices?.[0]?.segments?.[0]?.marketing_carrier_flight_number ?? ""}`.trim(), payload: o, facts: duffelFacts(o) };
    });
  },
  async quote() { throw new Error("STUB: live quotes are not wired"); },
  async book() { throw new Error("STUB: booking through a live provider is not enabled in this prototype"); },
};

function duffelFacts(o: { owner?: { name?: string }; slices?: { duration?: string; segments?: { marketing_carrier_flight_number?: string; marketing_carrier?: { iata_code?: string }; origin?: { iata_code?: string }; destination?: { iata_code?: string }; departing_at?: string; arriving_at?: string }[] }[] }): FlightFacts | undefined {
  const segs = o.slices?.[0]?.segments;
  if (!segs?.length) return undefined;
  const first = segs[0], last = segs[segs.length - 1];
  if (!first.departing_at || !last.arriving_at) return undefined;
  return { carrier: o.owner?.name ?? first.marketing_carrier?.iata_code ?? "Airline", flightNo: `${first.marketing_carrier?.iata_code ?? ""}${first.marketing_carrier_flight_number ?? ""}`, from: first.origin?.iata_code ?? "", to: last.destination?.iata_code ?? "", departLocal: first.departing_at.slice(0, 16), arriveLocal: last.arriving_at.slice(0, 16), stops: segs.length - 1 };
}
