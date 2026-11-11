import { and, eq } from "drizzle-orm";
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
  const items = await db.select().from(s.bookingItems).where(and(eq(s.bookingItems.bookingId, b.id), eq(s.bookingItems.status, "confirmed")));
  const [it] = await db.select().from(s.itineraries).where(eq(s.itineraries.id, b.itineraryId));
  return json({ booking: { ...b, title: it.title }, items, notice: "Sample data." });
});
