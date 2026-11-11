import { AmadeusFlightProvider } from "./amadeus";
import { DuffelFlightProvider } from "./duffel";
import type { FlightProvider, FlightQuery, Offer } from "./types";

export type CompareOffer = { id: string; provider: string; providerLabel: string; source: string; totalInr: number; perTravellerInr: number; breakup: Offer["breakup"]; facts: NonNullable<Offer["facts"]>; validUntil: string };
export type CompareResult = {
  configured: boolean;
  providers: { name: string; ok: boolean; count: number; error?: string }[];
  /** Cheapest first. Only real provider prices: sample (mock) fares are never mixed in. */
  offers: CompareOffer[];
  cheapestId?: string;
  fastestId?: string;
};

const LABEL: Record<string, string> = { amadeus: "Amadeus", duffel: "Duffel" };
export const realProviders = (list: FlightProvider[] = [AmadeusFlightProvider, DuffelFlightProvider]) => list.filter((p) => p.enabled());

/** Ask every enabled OFFICIAL price API for the same trip, in parallel, and rank the answers. One provider failing never hides the others. */
export async function compareFlights(q: FlightQuery, list?: FlightProvider[]): Promise<CompareResult> {
  const active = realProviders(list);
  if (!active.length) return { configured: false, providers: [], offers: [] };
  const settled = await Promise.all(active.map(async (p) => {
    try { return { p, offers: await p.search(q), error: undefined as string | undefined }; }
    catch (e) { return { p, offers: [] as Offer[], error: e instanceof Error ? e.message : String(e) }; }
  }));
  const offers: CompareOffer[] = settled.flatMap(({ p, offers }) => offers.filter((o) => o.facts && o.totalInr > 0).map((o) => ({
    id: o.id, provider: p.name, providerLabel: LABEL[p.name] ?? p.name, source: o.source, totalInr: o.totalInr, perTravellerInr: Math.round(o.totalInr / Math.max(1, q.pax)),
    breakup: o.breakup, facts: o.facts!, validUntil: o.validUntil,
  })));
  offers.sort((a, b) => a.totalInr - b.totalInr || a.facts.stops - b.facts.stops);
  const top = offers.slice(0, 6);
  const fastest = top.filter((o) => o.facts.durationMin).sort((a, b) => a.facts.durationMin! - b.facts.durationMin!)[0];
  return {
    configured: true,
    providers: settled.map(({ p, offers, error }) => ({ name: LABEL[p.name] ?? p.name, ok: !error, count: offers.length, error })),
    offers: top, cheapestId: top[0]?.id, fastestId: fastest?.id,
  };
}
