import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { bookingForSession } from "@/lib/server/access";
import { handle, json } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ ref: string }> }) => {
  const sess = await requireSession();
  const { ref } = await ctx.params;
  const b = await bookingForSession(ref, sess);
  const db = await getDb();
  const rows = await db.select().from(s.toolCalls).where(eq(s.toolCalls.bookingId, b.id)).orderBy(desc(s.toolCalls.createdAt)).limit(100);
  return json({ log: rows.map((r) => ({ id: r.id, tool: r.tool, input: r.input, output: r.output, status: r.status, latencyMs: r.latencyMs, at: r.createdAt.toISOString() })) });
});
