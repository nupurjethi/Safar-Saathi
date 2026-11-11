import { z } from "zod";
import { handle, json, readJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { requireSession } from "@/lib/server/session";
import { selectTrip } from "@/lib/server/trips";
import { GateError } from "@/lib/gate/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** "Select this trip": creates a draft and builds its offline bundle immediately, before any payment. */
export const POST = handle(async (req: Request) => {
  const sess = await requireSession();
  rateLimit(`select:${sess.uid}`, 8, 60_000);
  const b = await readJson(req, z.object({ slug: z.string().max(96), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), pax: z.number().int().min(1).max(9) }));
  if (new Date(`${b.startDate}T00:00:00Z`).getTime() < Date.now() - 86400000) throw new GateError("BAD_REQUEST", 400, "Pick a date in the future.");
  return json(await selectTrip({ userId: sess.uid, ...b }), 201);
});
