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
const Common = { platform: z.enum(PLATFORM_IDS as [string, ...string[]]), itemId: z.string().uuid(), amountPaidInr: z.number().int().min(0).max(500000), confirmationCode: z.string().max(24).optional() };
const Body = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("extend"), ...Common, newCheckoutDate: z.string().max(10) }),
  z.object({ mode: z.literal("replace"), ...Common, hotelName: z.string().min(2).max(80), address: z.string().min(3).max(160), phone: z.string().max(20).optional(), lat: z.number(), lon: z.number(), checkinDate: z.string().max(10), checkoutDate: z.string().max(10), rooms: z.number().int().min(1).max(9) }),
]);

/**
 * The traveller booked or extended a hotel on a booking platform themselves and tells us what they booked. This changes nothing:
 * it makes a review card (same confirmation gate). Only their Confirm tap updates the trip and the offline guide.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ ref: string }> }) => {
  const sess = await requireSession();
  rateLimit(`exthotel:${sess.uid}`, 20, 60_000);
  const { ref } = await ctx.params;
  const b = await readJson(req, Body);
  const booking = await bookingForSession(ref, sess);
  if (booking.userId !== sess.uid) throw new GateError("FORBIDDEN", 403, "That booking belongs to someone else.");
  const card = await createQuote({ bookingRef: ref, userId: sess.uid, kind: "hotel_external", params: b });
  const db = await getDb();
  const [t] = await db.select().from(s.agentThreads).where(and(eq(s.agentThreads.userId, sess.uid), eq(s.agentThreads.bookingId, booking.id), eq(s.agentThreads.channel, "app"))).orderBy(desc(s.agentThreads.createdAt)).limit(1);
  const threadId = t?.id ?? (await db.insert(s.agentThreads).values({ userId: sess.uid, bookingId: booking.id, channel: "app" }).returning())[0].id;
  await db.insert(s.agentMessages).values({ threadId, role: "assistant", content: "Check these details against your hotel confirmation. If they match, tap Yes to update your trip.", parts: [{ t: "review", card }] });
  return json({ card }, 201);
});
