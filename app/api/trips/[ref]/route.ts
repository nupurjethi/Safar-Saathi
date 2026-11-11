import { handle, json } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { requireSession } from "@/lib/server/session";
import { deleteTripForUser } from "@/lib/server/delete-trip";

export const dynamic = "force-dynamic";
/** Delete one of your own trips for good (the app asks you to confirm first). */
export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ ref: string }> }) => {
  const sess = await requireSession(["traveller"]);
  rateLimit(`deltrip:${sess.uid}`, 20, 60 * 60_000);
  const { ref } = await ctx.params;
  return json(await deleteTripForUser(sess.uid, ref));
});
