import { getDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { publishPack } from "./build";

export type RefreshResult =
  | { ok: true; version: number; changed: boolean; regenerated: string[]; rulesOrigin: string }
  | { ok: false; message: string; version: number };

/**
 * Spec section 7 (server-side job, run only after apply_change succeeds; NOT callable by the model).
 * Recomputes the trip data, redrafts only the scenarios whose facts changed, validates, and publishes the next
 * version. If anything fails, the previous version stays active and the traveller is told.
 * Logged as the `refresh_offline_pack` action.
 */
export async function refreshOfflinePack(bookingId: string, change: string, dbIn?: Db): Promise<RefreshResult> {
  const db = dbIn ?? (await getDb());
  const t0 = Date.now();
  const [b] = await db.select({ v: s.bookings.packVersion }).from(s.bookings).where((await import("drizzle-orm")).eq(s.bookings.id, bookingId));
  try {
    const r = await publishPack(bookingId, db, { change });
    await db.insert(s.toolCalls).values({ bookingId, tool: "refresh_offline_pack", input: { change }, output: { version: r.version, regenerated: r.regenerated, rulesOrigin: r.rulesOrigin }, status: "ok", latencyMs: Date.now() - t0 });
    return { ok: true, version: r.version, changed: r.changed, regenerated: r.regenerated, rulesOrigin: r.rulesOrigin };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.insert(s.toolCalls).values({ bookingId, tool: "refresh_offline_pack", input: { change }, output: { error: message }, status: "error", latencyMs: Date.now() - t0 }).catch(() => {});
    return { ok: false, message, version: b?.v ?? 0 };
  }
}
