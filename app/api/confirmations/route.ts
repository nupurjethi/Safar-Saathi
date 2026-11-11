import { z } from "zod";
import { issueConfirmation } from "@/lib/gate/changes";
import { handle, json, readJson } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { rateLimit } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";
/** The Confirm tap. Only an authenticated request from the booking's owner can mint a token. */
export const POST = handle(async (req: Request) => {
  const sess = await requireSession();
  rateLimit(`confirm:${sess.uid}`, 10, 60_000);
  const { quoteId } = await readJson(req, z.object({ quoteId: z.string().uuid() }));
  const t = await issueConfirmation({ quoteId, userId: sess.uid });
  return json(t, { headers: { "Cache-Control": "no-store" } });
});
