import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { rateSeverity } from "@/lib/agent/severity";
import { openCase, maskPhone } from "@/lib/server/cases";
import { getLatestPack } from "@/lib/packs/build";
import { currentStay } from "@/lib/rules/context";
import type { OfflinePack } from "@/lib/packs/types";
import { getSmsAdapter } from "./adapter";

const REF_RE = /\bSS-?(\d{5})\b/i;
const sms160 = (t: string) => (t.length <= 160 ? t : t.slice(0, 157) + "...");

/** Find the booking: by the sender's registered number, otherwise by an SS-##### ref in the text. */
async function matchBooking(db: Db, from: string, body: string) {
  const m = body.match(REF_RE);
  if (m) {
    const [b] = await db.select().from(s.bookings).where(eq(s.bookings.ref, `SS-${m[1]}`)).limit(1);
    if (b) return b;
  }
  const [u] = await db.select().from(s.users).where(eq(s.users.phoneE164, from)).limit(1);
  if (!u) return null;
  const [b] = await db.select().from(s.bookings).where(eq(s.bookings.userId, u.id)).orderBy(desc(s.bookings.startDate)).limit(1);
  return b ?? null;
}

/**
 * SMS fallback: same severity rubric and case flow as the app. Read-only answers come from the saved pack.
 * Idempotent by provider message id. Replies are <= 160 characters.
 */
export async function handleInboundSms(msg: { from: string; body: string; messageId: string }, dbIn?: Db) {
  const db = dbIn ?? (await getDb());
  const body = msg.body.slice(0, 500);
  const dup = await db.select().from(s.smsMessages).where(and(eq(s.smsMessages.providerMessageId, msg.messageId), eq(s.smsMessages.direction, "in"))).limit(1);
  if (dup.length) {
    const prev = await db.select().from(s.smsMessages).where(and(eq(s.smsMessages.direction, "out"), eq(s.smsMessages.caseId, dup[0].caseId ?? sql`null`))).orderBy(desc(s.smsMessages.createdAt)).limit(1);
    return { duplicate: true as const, reply: prev[0]?.body ?? "Already received.", caseRef: null as string | null, severity: null as number | null };
  }
  const booking = await matchBooking(db, msg.from, body);
  const rating = rateSeverity(body);
  let reply: string;
  let caseId: string | null = null;
  let caseRef: string | null = null;

  if (!booking) {
    // Unknown sender and no booking ref: the agent must still see it (a stranded traveller may be texting from a new SIM).
    const c = await openCase({ bookingId: null, channel: "sms", severity: Math.min(rating.severity, 3) as 1 | 2 | 3, summary: `Unmatched sender ${maskPhone(msg.from)}, no booking ref. ${rating.reason}: ${body}` }, db);
    caseId = c.id;
    caseRef = c.caseRef;
    reply = rating.severity <= 2 ? `Severity ${rating.severity}. Our team has been alerted. Case ID ${c.caseRef}. Reply with your booking ref, like SS-48213.` : `Got your message. Case ID ${c.caseRef}. Reply with your booking ref, like SS-48213, so we can find your trip.`;
  } else if (rating.severity <= 2) {
    const c = await openCase({ bookingId: booking.id, channel: "sms", severity: rating.severity, summary: `${rating.reason}: ${body}` }, db);
    caseId = c.id;
    caseRef = c.caseRef;
    reply = rating.severity === 1 ? `Severity 1. Human paged. Case ID ${c.caseRef}.` : `Severity 2. Our team will contact you. Case ID ${c.caseRef}.`;
  } else {
    const row = await getLatestPack(booking.id, db);
    const pack = row?.pack as OfflinePack | undefined;
    if (pack && /pick-?up|driver|transfer/i.test(body)) {
      const st = currentStay(pack, new Date());
      reply = sms160(`Pickup: ${st.driver.pickup_time}, ${st.driver.name}, code ${st.driver.pickup_code}. Booking ${booking.ref}.`);
    } else if (pack && /hotel|address|stay/i.test(body)) {
      const st = currentStay(pack, new Date());
      const h = pack.places[st.hotelId];
      reply = sms160(`Hotel: ${h.name}, ${h.address}. Booking ${booking.ref}.`);
    } else {
      reply = `Got it, booking ${booking.ref}. For emergencies text SOS. Open the app with data for changes.`;
    }
  }
  await db.insert(s.smsMessages).values({ providerMessageId: msg.messageId, direction: "in", fromMasked: maskPhone(msg.from), body, caseId });
  const adapter = getSmsAdapter();
  const sent = await adapter.send(msg.from, reply);
  await db.insert(s.smsMessages).values({ providerMessageId: sent.id, direction: "out", fromMasked: maskPhone(msg.from), body: reply, caseId });
  return { duplicate: false as const, reply, caseRef, severity: caseId ? rating.severity : null, bookingRef: booking?.ref ?? null, stub: sent.stub };
}

/** Retention: delete SMS bodies after N days (default 30). Run from the Vercel cron route. */
export async function purgeOldSms(days = Number(process.env.SMS_RETENTION_DAYS ?? 30), dbIn?: Db) {
  const db = dbIn ?? (await getDb());
  const res = await db.delete(s.smsMessages).where(sql`${s.smsMessages.createdAt} < now() - (${days} * interval '1 day')`).returning({ id: s.smsMessages.id });
  return res.length;
}
