import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { handle, json } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
/** Start a new travel plan upload (files are added one by one, then processed). */
export const POST = handle(async () => {
  const sess = await requireSession(["traveller"]);
  rateLimit(`plan:${sess.uid}`, 20, 60 * 60_000);
  const db = await getDb();
  const [p] = await db.insert(s.travelPlans).values({ userId: sess.uid, status: "uploading" }).returning({ id: s.travelPlans.id });
  return json({ planId: p.id }, 201);
});

export const GET = handle(async () => {
  const sess = await requireSession();
  const db = await getDb();
  const rows = await db.select({ id: s.travelPlans.id, title: s.travelPlans.title, status: s.travelPlans.status, error: s.travelPlans.error, bookingId: s.travelPlans.bookingId, createdAt: s.travelPlans.createdAt }).from(s.travelPlans).where(eq(s.travelPlans.userId, sess.uid)).orderBy(desc(s.travelPlans.createdAt)).limit(30);
  return json({ plans: rows });
});
