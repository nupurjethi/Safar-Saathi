import { z } from "zod";
import { handle, json, readJson } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { recordManualReference } from "@/lib/providers/manual";

export const dynamic = "force-dynamic";
/** "I booked this on another site": records the reference the traveller pastes. Nothing is fetched or scraped. */
export const POST = handle(async (req: Request) => {
  await requireSession();
  const b = await readJson(req, z.object({ kind: z.enum(["flight", "stay"]), reference: z.string().min(3).max(40), note: z.string().max(200).optional() }));
  return json(await recordManualReference(b), 201);
});
