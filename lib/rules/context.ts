import type { OfflinePack, PackStay } from "@/lib/packs/types";
import { localDate } from "@/lib/time";

/** Which stay is the traveller in? By date unless the traveller picks a city (or GPS decides). */
export function currentStay(pack: OfflinePack, now: Date, cityOverride?: string): PackStay {
  if (cityOverride) {
    const hit = pack.stays.find((s) => s.city === cityOverride);
    if (hit) return hit;
  }
  const today = pack.stays.length ? localDate(now, pack.stays[0].tz) : "";
  return (
    pack.stays.find((s, i) => today >= s.from && (today < s.to || (i === pack.stays.length - 1 && today <= s.to))) ??
    (today < pack.stays[0].from ? pack.stays[0] : pack.stays[pack.stays.length - 1])
  );
}

const fmt = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(new Date(iso));

/** Template context: the pack itself plus a `current.*` view for the stay the traveller is in. */
export function buildContext(pack: OfflinePack, now = new Date(), cityOverride?: string): Record<string, unknown> {
  const stay = currentStay(pack, now, cityOverride);
  const upcoming = pack.flights.filter((f) => new Date(f.depart_at) >= new Date(now.getTime() - 6 * 3600e3));
  const next = upcoming[0] ?? pack.flights[pack.flights.length - 1];
  const onward = upcoming[1];
  const NG = "not in your documents";
  const ff = (f?: typeof next) =>
    f
      ? { flight_no: f.flight_no || NG, carrier: f.carrier || NG, from: f.from || NG, to: f.to || NG, pnr: f.pnr || NG, depart: fmt(f.depart_at, f.from_tz), arrive: fmt(f.arrive_at, f.to_tz) }
      // an uploaded plan may contain no flights at all: the guide still builds and says so instead of failing
      : { flight_no: NG, carrier: NG, from: NG, to: NG, pnr: NG, depart: NG, arrive: NG };
  const hotel = pack.places[stay.hotelId];
  const airport = pack.places[stay.airportId];
  return {
    booking: pack.booking,
    contacts: pack.contacts,
    places: pack.places,
    current: {
      city: stay.cityName,
      hotel: hotel && { ...hotel, phone: hotel.phone },
      airport,
      emergency: stay.emergency,
      consulate: stay.consulate,
      driver: stay.driver,
      drop_driver: stay.dropDriver,
      next_flight: ff(next),
      onward_flight: ff(onward) ?? ff(next),
    },
  };
}
