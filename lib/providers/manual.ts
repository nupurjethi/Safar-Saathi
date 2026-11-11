import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";

/**
 * "I booked this on another site": the traveller pastes a reference and the app records it. Nothing is fetched from
 * that site (we never scrape travel sites). The record is stored as an offer with provider = manual.
 */
export async function recordManualReference(input: { kind: "flight" | "stay"; reference: string; note?: string }) {
  const db = await getDb();
  const [row] = await db.insert(s.providerOffers).values({
    provider: "manual", kind: input.kind, payload: { reference: input.reference.slice(0, 40), note: (input.note ?? "").slice(0, 200), recordedAt: new Date().toISOString() },
    breakup: [], validUntil: new Date(Date.now() + 365 * 86400_000),
  }).returning({ id: s.providerOffers.id });
  return { id: row.id, provider: "manual" as const, source: "Entered by you, not verified" };
}
