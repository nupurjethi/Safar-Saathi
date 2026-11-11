import { z } from "zod";
import { SLA_SECONDS } from "@/lib/agent/severity";
import { openCase } from "@/lib/server/cases";
import { bookingForSession } from "@/lib/server/access";
import { handle, json, readJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { requireSession } from "@/lib/server/session";
import { GateError } from "@/lib/gate/errors";

export const dynamic = "force-dynamic";
/** Online SOS: opens a severity-1 case for a human. The traveller keeps the offline guide while waiting. */
export const POST = handle(async (req: Request) => {
  const sess = await requireSession();
  rateLimit(`sos:${sess.uid}`, 6, 60_000);
  const b = await readJson(req, z.object({ bookingRef: z.string().regex(/^SS-\d{5}$/), scenario: z.string().max(40).optional(), note: z.string().max(300).optional(), lat: z.number().optional(), lon: z.number().optional() }));
  const booking = await bookingForSession(b.bookingRef, sess);
  if (booking.userId !== sess.uid) throw new GateError("FORBIDDEN", 403, "That booking belongs to someone else.");
  const where = b.lat !== undefined && b.lon !== undefined ? ` Location ${b.lat.toFixed(4)}, ${b.lon.toFixed(4)}.` : "";
  const c = await openCase({ bookingId: booking.id, channel: "app", severity: 1, summary: `SOS from app${b.scenario ? `: ${b.scenario}` : ""}.${where}${b.note ? ` Note: ${b.note}` : ""}` });
  return json({ caseRef: c.caseRef, severity: 1, slaSeconds: SLA_SECONDS[1], message: "A person has been paged. Stay on this screen. The offline guide is still available." });
});
