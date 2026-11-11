import { z } from "zod";
import { SLA_SECONDS } from "@/lib/agent/severity";
import { getDb } from "@/lib/db/client";
import { bookingForSession } from "@/lib/server/access";
import { syncLocalCase } from "@/lib/server/cases";
import { GateError } from "@/lib/gate/errors";
import { handle, json, readJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
const Body = z.object({
  localId: z.string().min(8).max(64), // generated on the phone when the SOS was queued
  queuedAt: z.string().max(40),
  bookingRef: z.string().regex(/^SS-\d{5}$/),
  scenario: z.string().max(40).optional(),
  note: z.string().max(300).optional(),
  lat: z.number().optional(), lon: z.number().optional(),
});

/**
 * Upload an SOS case that was saved on the phone while offline. Idempotent by the phone's local id:
 * sending the same case twice returns the same server case reference (spec section 8.2 and 8.3).
 */
export const POST = handle(async (req: Request) => {
  const sess = await requireSession();
  rateLimit(`cases:${sess.uid}`, 20, 60_000);
  const b = await readJson(req, Body);
  const db = await getDb();
  const booking = await bookingForSession(b.bookingRef, sess);
  if (booking.userId !== sess.uid) throw new GateError("FORBIDDEN", 403, "That trip belongs to someone else.");
  const out = await syncLocalCase({ localId: b.localId, queuedAt: b.queuedAt, bookingId: booking.id, scenario: b.scenario, note: b.note, lat: b.lat, lon: b.lon }, db);
  return json({ ...out, slaSeconds: SLA_SECONDS[1] }, out.duplicate ? 200 : 201);
});
