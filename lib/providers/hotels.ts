/**
 * Live hotel prices from an OFFICIAL API: Amadeus for Developers (Hotel List by geocode + Hotel Search offers). Same keys as the
 * flight search (AMADEUS_API_KEY / AMADEUS_API_SECRET / AMADEUS_ENV). Search only: the traveller books and pays on their own
 * platform. No scraping. Test-environment data is limited.
 */
const base = () => (process.env.AMADEUS_ENV === "production" ? "https://api.amadeus.com" : "https://test.api.amadeus.com");
let token: { value: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && token.exp > Date.now() + 30_000) return token.value;
  const res = await fetch(`${base()}/v1/security/oauth2/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.AMADEUS_API_KEY!, client_secret: process.env.AMADEUS_API_SECRET! }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Amadeus sign-in ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.value;
}

export type HotelQuery = { lat: number; lon: number; checkin: string; checkout: string; rooms: number; adults: number };
export type HotelOffer = {
  id: string; provider: "amadeus"; providerLabel: string; source: string; hotelName: string; address?: string; lat?: number; lon?: number; roomType?: string;
  totalInr: number; perNightInr: number; breakup: { label: string; amountInr: number }[]; refundable: boolean; cancellation?: string; validUntil: string;
};

type AmadeusHotelOffers = {
  data?: { hotel: { hotelId: string; name: string; latitude?: number; longitude?: number; address?: { lines?: string[]; cityName?: string } }; offers?: { id: string; checkInDate: string; checkOutDate: string; room?: { typeEstimated?: { category?: string; beds?: number; bedType?: string } }; price: { currency: string; base?: string; total: string; taxes?: { amount?: string; code?: string }[] }; policies?: { cancellations?: { deadline?: string; amount?: string; description?: { text?: string } }[]; refundable?: { cancellationRefund?: string } } }[] }[];
};
const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3));

/** Pure mapping, exported for tests. */
export function mapAmadeusHotels(j: AmadeusHotelOffers, q: Pick<HotelQuery, "rooms">, fxToInr = 1): HotelOffer[] {
  const out: HotelOffer[] = [];
  for (const h of j.data ?? []) {
    const o = h.offers?.[0];
    if (!o) continue;
    const cur = o.price.currency;
    const conv = (x: string | number) => Math.round(Number(x) * (cur === "INR" ? 1 : fxToInr));
    const total = conv(o.price.total);
    const baseAmt = o.price.base !== undefined ? conv(o.price.base) : total;
    const nights = nightsBetween(o.checkInDate, o.checkOutDate);
    const breakup = [{ label: `Room rate (${nights} night${nights > 1 ? "s" : ""} × ${q.rooms} room${q.rooms > 1 ? "s" : ""}, ${cur} ${o.price.base ?? o.price.total})`, amountInr: baseAmt }, ...(total - baseAmt > 0 ? [{ label: "Taxes and fees", amountInr: total - baseAmt }] : [])];
    const cancel = o.policies?.cancellations?.[0];
    const room = o.room?.typeEstimated;
    out.push({
      id: `amadeus:${o.id}`, provider: "amadeus", providerLabel: "Amadeus", source: `Live price from Amadeus (${process.env.AMADEUS_ENV === "production" ? "production" : "test"} data), checked just now`,
      hotelName: h.hotel.name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()), address: h.hotel.address?.lines?.join(", "), lat: h.hotel.latitude, lon: h.hotel.longitude,
      roomType: room ? [room.category?.replace(/_/g, " ").toLowerCase(), room.beds ? `${room.beds} ${room.bedType?.toLowerCase() ?? "bed"}` : ""].filter(Boolean).join(", ") : undefined,
      totalInr: total, perNightInr: Math.round(total / nights / Math.max(1, q.rooms)), breakup, refundable: !!cancel && cancel.amount === "0.00",
      cancellation: cancel?.deadline ? `Free cancellation until ${cancel.deadline.slice(0, 10)}` : cancel?.description?.text, validUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
  }
  return out;
}

export const hotelPriceSourceEnabled = () => !!process.env.AMADEUS_API_KEY && !!process.env.AMADEUS_API_SECRET;

export async function searchHotels(q: HotelQuery): Promise<HotelOffer[]> {
  if (!hotelPriceSourceEnabled()) return [];
  const auth = { Authorization: `Bearer ${await accessToken()}` };
  const geo = new URLSearchParams({ latitude: String(q.lat), longitude: String(q.lon), radius: "6", radiusUnit: "KM", hotelSource: "ALL" });
  const list = await fetch(`${base()}/v1/reference-data/locations/hotels/by-geocode?${geo}`, { headers: auth, signal: AbortSignal.timeout(20000) });
  if (!list.ok) throw new Error(`Amadeus hotel list ${list.status}`);
  const ids = ((await list.json()) as { data?: { hotelId: string }[] }).data?.slice(0, 25).map((h) => h.hotelId) ?? [];
  if (!ids.length) return [];
  const params = new URLSearchParams({ hotelIds: ids.join(","), checkInDate: q.checkin, checkOutDate: q.checkout, adults: String(Math.min(q.adults, 9)), roomQuantity: String(Math.min(q.rooms, 9)), currency: "INR", bestRateOnly: "true" });
  const res = await fetch(`${base()}/v3/shopping/hotel-offers?${params}`, { headers: auth, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`Amadeus hotel offers ${res.status}`);
  return mapAmadeusHotels((await res.json()) as AmadeusHotelOffers, q, Number(process.env.FX_TO_INR ?? 1));
}

export type HotelCompare = { configured: boolean; providers: { name: string; ok: boolean; count: number; error?: string }[]; offers: HotelOffer[]; cheapestId?: string };
export async function compareHotels(q: HotelQuery, search: (q: HotelQuery) => Promise<HotelOffer[]> = searchHotels, enabled: () => boolean = hotelPriceSourceEnabled): Promise<HotelCompare> {
  if (!enabled()) return { configured: false, providers: [], offers: [] };
  try {
    const offers = (await search(q)).filter((o) => o.totalInr > 0).sort((a, b) => a.totalInr - b.totalInr).slice(0, 6);
    return { configured: true, providers: [{ name: "Amadeus", ok: true, count: offers.length }], offers, cheapestId: offers[0]?.id };
  } catch (e) {
    return { configured: true, providers: [{ name: "Amadeus", ok: false, count: 0, error: e instanceof Error ? e.message : String(e) }], offers: [] };
  }
}
