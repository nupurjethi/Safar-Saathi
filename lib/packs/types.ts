import type { SavedRoute } from "@/lib/map/routes";
import type { Scenario } from "@/lib/rules/engine";
import type { RulesMeta } from "@/lib/rules/generate";
import type { RuleSetIn } from "@/lib/rules/schema";

/** A real, openly licensed photo of a real landmark, saved with the trip so it shows offline. */
export type PlaceImageRef = { src: string; title: string; author: string; license: string; licenseUrl: string; sourceUrl: string; /** set for photos stored in the database (uploaded plans): size and hash for the offline manifest */ bytes?: number; sha256?: string };

export type PackPlace = {
  id: string;
  kind: "hotel" | "airport" | "poi" | "station";
  city: string; // destination slug
  name: string;
  name_local: string;
  address: string;
  address_local: string;
  lat: number;
  lon: number;
  phone?: string;
  image?: PlaceImageRef;
};

export type PackFlight = {
  leg: "outbound" | "intercity" | "return";
  flight_no: string;
  carrier: string;
  from: string;
  to: string;
  from_tz: string;
  to_tz: string;
  depart_at: string; // ISO
  arrive_at: string;
  pnr: string;
};

export type PackItem = {
  time: string; // HH:mm local to the city of the day
  type: "flight" | "transfer" | "hotel" | "activity" | "meal" | "free";
  title: string;
  notes?: string;
  placeId?: string;
};

export type PackDay = { date: string; dayNo: number; city: string; cityName: string; tz: string; title: string; items: PackItem[] };

export type PackStay = {
  city: string;
  cityName: string;
  tz: string;
  from: string; // check-in date
  to: string; // check-out date
  hotelId: string;
  airportId: string;
  emergency: { general: string; police: string; ambulance: string; verified: boolean };
  consulate: { name: string; address: string; phone: string; sample: true };
  driver: { name: string; vendor: string; phone: string; pickup_code: string; pickup_time: string };
  dropDriver: { name: string; vendor: string; phone: string; pickup_code: string };
};

export type PackMapCity = {
  id: string; name: string;
  /** overview tiles: whole city + airport, zoom 0-12 */
  pmtiles: string | null; bytes: number;
  /** core tiles: hotels + landmarks, street level to zoom 15 */
  core?: { pmtiles: string; bytes: number; bbox: [number, number, number, number] } | null;
  bbox: [number, number, number, number]; center: [number, number];
};

export type OfflinePack = {
  packVersion: number;
  contentHash: string;
  builtAt: string;
  booking: { ref: string; status: "draft" | "confirmed"; pax: number; dates: [string, string]; totalInr: number; title: string; origin: string; travellers: string[] };
  days: PackDay[];
  places: Record<string, PackPlace>;
  stays: PackStay[];
  flights: PackFlight[];
  contacts: {
    airline: string;
    airline_phone: string;
    insurance_phone: string;
    sms_gateway: string;
    emergency: string;
    hotels: { city: string; name: string; phone: string; address_local: string }[];
    sample: true;
  };
  routes: SavedRoute[];
  /** Interpreter-format scenarios (derived from the frozen, validated rule set). Read-only offline. */
  rules: Record<string, Scenario>;
  rulesMeta: RulesMeta;
  ruleSet: RuleSetIn;
  map: { cities: PackMapCity[]; style: string; glyphs: string; sprite: string };
  disclaimer: string;
};

export type PackManifestFile = { url: string; kind: "pack" | "tiles" | "map-asset" | "image" | "page"; bytes: number; hash?: string };
export type PackManifest = {
  bookingRef: string;
  packVersion: number;
  contentHash: string;
  builtAt: string;
  totalBytes: number;
  budgetBytes: number;
  overBudget: boolean;
  files: PackManifestFile[];
};
