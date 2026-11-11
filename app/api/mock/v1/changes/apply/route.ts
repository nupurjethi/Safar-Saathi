import { z } from "zod";
import { applyChange } from "@/lib/gate/changes";
import { handle, json, readJson } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { rateLimit } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";
const Body = z.object({ quoteId: z.string().uuid(), token: z.string().max(200).optional().nullable(), threadId: z.string().uuid().optional().nullable() });

/** Requires a valid single-use confirmation token minted by POST /api/confirmations. */
export const POST = handle(async (req: Request) => {
  const sess = await requireSession();
  rateLimit(`apply:${sess.uid}`, 15, 60_000);
  const body = await readJson(req, Body);
  const receipt = await applyChange({ quoteId: body.quoteId, token: body.token, userId: sess.uid, threadId: body.threadId });
  return json({ receipt });
});
