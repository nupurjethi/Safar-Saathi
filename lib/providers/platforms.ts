/**
 * Booking platforms a traveller may have bought their ticket on.
 *
 * HONEST BOUNDARY: none of these sites offers a way for another app to sign in to a customer's account, read a booking or
 * change a ticket (their APIs are for contracted business partners). So Safar Saathi does NOT ask for their passwords,
 * does not log in on anyone's behalf and never scrapes them. It only LINKS OUT: the button opens the platform's own
 * flight-search or "my trips" page in a new tab, where the traveller logs in themselves and does the change. They then
 * come back and record the new flight here; that record goes through the confirmation gate like any other change.
 * This file builds links only. It must never call fetch() (tests enforce it).
 */
export type PlatformId = "makemytrip" | "goibibo" | "cleartrip" | "ixigo";
export const PLATFORM_IDS: PlatformId[] = ["makemytrip", "goibibo", "cleartrip", "ixigo"];

export type SearchInput = { from: string; to: string; date: string; pax: number };
export type Platform = {
  id: PlatformId;
  name: string;
  /** Opens the platform's flight results for the same route and day (the traveller logs in on the site). */
  searchUrl: (q: SearchInput & { international: boolean }) => string;
  /** Opens the platform's own "my trips / manage booking" area. */
  manageUrl: string;
  /** Opens the platform's hotel search page. These sites do not accept a reliable pre-filled hotel link, so the traveller enters the city and dates shown on our card. */
  hotelsUrl: string;
};

const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const ddmmyyyy = (d: string) => `${d.slice(8, 10)}${d.slice(5, 7)}${d.slice(0, 4)}`;
const ymd = (d: string) => d.replace(/-/g, "");

export const PLATFORMS: Record<PlatformId, Platform> = {
  makemytrip: {
    id: "makemytrip", name: "MakeMyTrip",
    searchUrl: (q) => `https://www.makemytrip.com/flight/search?itinerary=${q.from}-${q.to}-${dmy(q.date)}&tripType=O&paxType=A-${q.pax}_C-0_I-0&intl=${q.international}&cabinClass=E&lang=eng`,
    manageUrl: "https://www.makemytrip.com/mybookings/",
    hotelsUrl: "https://www.makemytrip.com/hotels/",
  },
  goibibo: {
    id: "goibibo", name: "Goibibo",
    searchUrl: (q) => `https://www.goibibo.com/flights/air-${q.from}-${q.to}-${ymd(q.date)}-${q.pax}-0-0-E-D/`,
    manageUrl: "https://www.goibibo.com/mytrips/",
    hotelsUrl: "https://www.goibibo.com/hotels/",
  },
  cleartrip: {
    id: "cleartrip", name: "Cleartrip",
    searchUrl: (q) => `https://www.cleartrip.com/flights/results?adults=${q.pax}&childs=0&infants=0&class=Economy&depart_date=${dmy(q.date)}&from=${q.from}&to=${q.to}&intl=${q.international ? "y" : "n"}`,
    manageUrl: "https://www.cleartrip.com/account/trips",
    hotelsUrl: "https://www.cleartrip.com/hotels",
  },
  ixigo: {
    id: "ixigo", name: "ixigo",
    searchUrl: (q) => `https://www.ixigo.com/search/result/flight?from=${q.from}&to=${q.to}&date=${ddmmyyyy(q.date)}&adults=${q.pax}&children=0&infants=0&class=e&source=Search+Form`,
    manageUrl: "https://www.ixigo.com/",
    hotelsUrl: "https://www.ixigo.com/hotels",
  },
};

const DOMESTIC = new Set(["DEL", "BOM", "BLR", "HYD", "MAA", "CCU", "PNQ", "AMD", "GOI", "COK", "JAI", "LKO", "TRV", "IXC"]);
export const isInternational = (from: string, to: string) => !(DOMESTIC.has(from) && DOMESTIC.has(to));

export function platformLinks(q: SearchInput) {
  const international = isInternational(q.from, q.to);
  return PLATFORM_IDS.map((id) => ({ id, name: PLATFORMS[id].name, searchUrl: PLATFORMS[id].searchUrl({ ...q, international }), manageUrl: PLATFORMS[id].manageUrl }));
}
export const isPlatformId = (x: unknown): x is PlatformId => typeof x === "string" && (PLATFORM_IDS as string[]).includes(x);

/** Hotel search pages (no pre-fill: see Platform.hotelsUrl). */
export const hotelLinks = () => PLATFORM_IDS.map((id) => ({ id, name: PLATFORMS[id].name, hotelsUrl: PLATFORMS[id].hotelsUrl }));
