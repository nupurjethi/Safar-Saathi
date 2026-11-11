import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { GateError } from "@/lib/gate/errors";
import { handle, json, readJson } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
/** Take over or close a case. Only humans can close a severity-1 case. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const sess = await requireSession(["admin", "agent"]);
  const { id } = await ctx.params;
  const { action } = await readJson(req, z.object({ action: z.enum(["take", "close"]).default("take") }));
  const db = await getDb();
  const [c] = await db.select().from(s.cases).where(eq(s.cases.id, id));
  if (!c) throw new GateError("NOT_FOUND", 404, "Case not found.");
  await db.update(s.cases).set(action === "take" ? { status: "taken", assignedTo: sess.name, updatedAt: new Date() } : { status: "closed", updatedAt: new Date() }).where(eq(s.cases.id, id));
  return json({ ok: true });
});
