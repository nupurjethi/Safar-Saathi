import { randomUUID } from "node:crypto";
import { searchFlights } from "@/app/api/mock/v1/flights/search/route";
import { stayAvailability } from "@/app/api/mock/v1/stays/availability/route";
import { assertBreakup, type FlightProvider, type FlightQuery, type Offer, type StayProvider, type StayQuery } from "./types";

export const MOCK_SOURCE = "Sample data (mock API)";
const TAX_RATE = 0.12; // sample taxes and fees on a fresh ticket

/** Default provider, always on: our own mock travel API. */
export const MockFlightProvider: FlightProvider = {
  name: "mock",
  enabled: () => true,
  async search(q: FlightQuery) {
    const rows = await searchFlights({ from: q.from, to: q.to, date: q.date, pax: q.pax, anchor: q.anchor ?? "depart" });
    return rows.filter((f) => f.available).map((f): Offer => {
      const base = f.farePerPaxInr * q.pax;
      const taxes = Math.round(base * TAX_RATE);
      const breakup = [{ label: `Base fare (₹${f.farePerPaxInr} per person × ${q.pax})`, amountInr: base }, { label: "Taxes and fees (sample)", amountInr: taxes }];
      const total = base + taxes;
      assertBreakup(breakup, total);
      return { id: f.id, provider: "mock", kind: "flight", source: MOCK_SOURCE, validUntil: new Date(Date.now() + 15 * 60_000).toISOString(), breakup, totalInr: total, refundable: false, summary: `${f.carrierName} ${f.flightNo}, ${f.from} to ${f.to}`, payload: f };
    });
  },
  async quote(id) { throw new Error(`Use quote_change for ${id}: mock offers are priced against your booking`); },
  async book() { return { reference: `SSM-${randomUUID().slice(0, 6).toUpperCase()}` }; },
};

export const MockStayProvider: StayProvider = {
  name: "mock",
  enabled: () => true,
  async search(q: StayQuery) {
    const a = await stayAvailability(q);
    if (!a.available || a.totalInr == null) return [];
    const breakup = [{ label: `Room rate (${q.nights} night${q.nights > 1 ? "s" : ""} × ${q.rooms} room${q.rooms > 1 ? "s" : ""})`, amountInr: a.totalInr }];
    return [{ id: `${q.hotelId}:${q.checkin}:${q.nights}`, provider: "mock", kind: "stay", source: MOCK_SOURCE, validUntil: new Date(Date.now() + 15 * 60_000).toISOString(), breakup, totalInr: a.totalInr, refundable: false, summary: `${a.hotel?.name ?? "Hotel"}, ${q.nights} extra night${q.nights > 1 ? "s" : ""}`, payload: a }];
  },
  async quote(id) { throw new Error(`Use quote_change for ${id}`); },
  async book() { return { reference: `SSM-${randomUUID().slice(0, 6).toUpperCase()}` }; },
};
