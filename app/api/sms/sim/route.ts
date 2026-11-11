import { z } from "zod";
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { handle, json, readJson } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { handleInboundSms } from "@/lib/sms/inbound";
import { rateLimit } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";
/** SMS simulator backend (/admin/sms-sim). Same handler as the real webhook, no gateway needed. */
export const POST = handle(async (req: Request) => {
  const sess = await requireSession(["admin", "agent"]);
  rateLimit(`smssim:${sess.uid}`, 30, 60_000);
  const b = await readJson(req, z.object({ from: z.string().max(20).default("+919800000001"), body: z.string().min(1).max(500) }));
  const r = await handleInboundSms({ from: b.from, body: b.body, messageId: `sim-${crypto.randomUUID()}` });
  return json(r);
});

export const GET = handle(async () => {
  await requireSession(["admin", "agent"]);
  const db = await getDb();
  const rows = await db.select().from(s.smsMessages).orderBy(desc(s.smsMessages.createdAt)).limit(50);
  return json({ messages: rows.reverse().map((m) => ({ id: m.id, direction: m.direction, from: m.fromMasked, body: m.body, at: m.createdAt.toISOString() })) });
});
