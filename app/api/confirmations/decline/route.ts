import { z } from "zod";
import { declineQuote } from "@/lib/gate/changes";
import { handle, json, readJson } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const POST = handle(async (req: Request) => {
  const sess = await requireSession();
  const { quoteId } = await readJson(req, z.object({ quoteId: z.string().uuid() }));
  return json(await declineQuote({ quoteId, userId: sess.uid }));
});
