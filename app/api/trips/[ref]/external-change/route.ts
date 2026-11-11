import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { createQuote } from "@/lib/gate/changes";
import { bookingForSession } from "@/lib/server/access";
import { GateError } from "@/lib/gate/errors";
import { handle, json, readJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { requireSession } from "@/lib/server/session";
import { PLATFORM_IDS } from "@/lib/providers/platforms";

export const dynamic = "force-dynamic";
const Body = z.object({
  platform: z.enum(PLATFORM_IDS as [string, ...string[]]),
  itemId: z.string().uuid(),
  flightNo: z.string().min(3).max(8),
  carrierName: z.string().min(2).max(40),
  departLocal: z.string().max(16),
  arriveLocal: z.string().max(16),
  pnr: z.string().min(5).max(10),
  fareDiffInr: z.number().int().min(0).max(500000),
  changeFeeInr: z.number().int().min(0).max(500000),
});

/**
 * The traveller changed their ticket on a booking platform themselves and now tells us what the new flight is.
 * This does NOT change anything: it creates a review card (same confirmation gate as every other change). Only their
 * Confirm tap on that card updates the trip and the offline guide. The card is also saved in the chat thread.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ ref: string }> }) => {
  const sess = await requireSession();
  rateLimit(`extchange:${sess.uid}`, 20, 60_000);
  const { ref } = await ctx.params;
  const b = await readJson(req, Body);
  const booking = await bookingForSession(ref, sess);
  if (booking.userId !== sess.uid) throw new GateError("FORBIDDEN", 403, "That booking belongs to someone else.");
  const card = await createQuote({ bookingRef: ref, userId: sess.uid, kind: "flight_external", params: b });
  const db = await getDb();
  const [t] = await db.select().from(s.agentThreads).where(and(eq(s.agentThreads.userId, sess.uid), eq(s.agentThreads.bookingId, booking.id), eq(s.agentThreads.channel, "app"))).orderBy(desc(s.agentThreads.createdAt)).limit(1);
  const threadId = t?.id ?? (await db.insert(s.agentThreads).values({ userId: sess.uid, bookingId: booking.id, channel: "app" }).returning())[0].id;
  await db.insert(s.agentMessages).values({ threadId, role: "assistant", content: "Check these details against your airline confirmation. If they match, tap Yes to update your trip.", parts: [{ t: "review", card }] });
  return json({ card }, 201);
});
