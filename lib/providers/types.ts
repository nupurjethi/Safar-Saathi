export type Breakup = { label: string; amountInr: number };

/** One offer shape for every provider. Prices from a real provider must say so and carry a validity time. */
export type Offer = {
  id: string;
  provider: "mock" | "duffel" | "amadeus" | "manual";
  kind: "flight" | "stay";
  /** "Sample data (mock API)" or "Live price from <provider>". */
  source: string;
  validUntil: string; // ISO
  breakup: Breakup[];
  totalInr: number;
  refundable: boolean;
  summary: string;
  payload: unknown;
  /** Structured trip facts when the provider supplies them (times are local to each airport, minute precision). */
  facts?: FlightFacts;
};

export type FlightFacts = { carrier: string; flightNo: string; from: string; to: string; departLocal: string; arriveLocal: string; stops: number; durationMin?: number };

export type FlightQuery = { from: string; to: string; date: string; pax: number; anchor?: "depart" | "arrive" };
export type StayQuery = { hotelId: string; checkin: string; nights: number; rooms: number };

export interface FlightProvider {
  name: Offer["provider"];
  enabled(): boolean;
  search(q: FlightQuery): Promise<Offer[]>;
  quote(offerId: string): Promise<Offer>;
  /** Booking always goes through the confirmation gate first. Real providers are not wired for booking in this prototype. */
  book(offerId: string): Promise<{ reference: string }>;
}
export interface StayProvider {
  name: Offer["provider"];
  enabled(): boolean;
  search(q: StayQuery): Promise<Offer[]>;
  quote(offerId: string): Promise<Offer>;
  book(offerId: string): Promise<{ reference: string }>;
}

/** Total must equal the sum of lines. A quote that does not add up is rejected and never shown. */
export function assertBreakup(breakup: Breakup[], totalInr: number) {
  const sum = breakup.reduce((a, l) => a + l.amountInr, 0);
  if (!Number.isInteger(totalInr) || sum !== totalInr) throw new Error(`BREAKUP_MISMATCH: lines sum to ${sum} but total is ${totalInr}`);
  if (breakup.some((l) => !l.label.trim() || !Number.isFinite(l.amountInr))) throw new Error("BREAKUP_INVALID: every line needs a label and an amount");
}
