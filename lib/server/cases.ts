import { count, desc, eq } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { SLA_SECONDS, type Severity } from "@/lib/agent/severity";

export const maskPhone = (p: string) => (p.length > 5 ? `${p.slice(0, 3)}${"•".repeat(Math.max(0, p.length - 6))}${p.slice(-3)}` : "•••");

export type OpenCaseInput = {
  bookingId?: string | null;
  channel: "app" | "sms";
  severity: Severity;
  summary: string;
};

/**
 * Opens a case for the human inbox. Severity 1 is "paged": STUB, we only mark it and log it. Wire a real pager
 * (Slack / PagerDuty / SMS to on-call) in `pageHuman` when you have keys.
 */
export async function openCase(input: OpenCaseInput, dbIn?: Db) {
  const db = dbIn ?? (await getDb());
  const [{ n }] = await db.select({ n: count() }).from(s.cases);
  const caseRef = `SS-C-${1000 + Number(n) + 1}`;
  const sla = new Date(Date.now() + SLA_SECONDS[input.severity] * 1000);
  const [c] = await db
    .insert(s.cases)
    .values({ caseRef, bookingId: input.bookingId ?? null, channel: input.channel, severity: input.severity, summary: input.summary.slice(0, 500), status: "open", slaDueAt: sla })
    .returning();
  await db.insert(s.events).values({ name: "case_opened", bookingId: input.bookingId ?? null, props: { caseRef, severity: input.severity, channel: input.channel } });
  if (input.severity === 1) await pageHuman(c);
  return c;
}

async function pageHuman(c: typeof s.cases.$inferSelect) {
  // STUB: no pager integration yet. The case is at the top of /admin/cases with a 60 s SLA countdown.
  console.log(`[STUB page] severity-1 case ${c.caseRef} needs a human within 60 s`);
}

export async function listCases(dbIn?: Db) {
  const db = dbIn ?? (await getDb());
  const rows = await db
    .select({ c: s.cases, ref: s.bookings.ref })
    .from(s.cases)
    .leftJoin(s.bookings, eq(s.bookings.id, s.cases.bookingId))
    .orderBy(desc(s.cases.createdAt))
    .limit(200);
  return rows.map(({ c, ref }) => ({ id: c.id, caseRef: c.caseRef, bookingRef: ref, channel: c.channel, severity: c.severity, summary: c.summary, status: c.status, assignedTo: c.assignedTo, slaDueAt: c.slaDueAt.toISOString(), createdAt: c.createdAt.toISOString() }));
}

/** Upload of an SOS saved on the phone. Idempotent by the phone's local id (spec 8.2, 8.3). */
export async function syncLocalCase(input: { localId: string; queuedAt: string; bookingId: string; scenario?: string; note?: string; lat?: number; lon?: number }, dbIn?: Db) {
  const db = dbIn ?? (await getDb());
  const [dup] = await db.select().from(s.sosCasesLocalSync).where(eq(s.sosCasesLocalSync.localId, input.localId)).limit(1);
  if (dup?.caseRef) return { caseRef: dup.caseRef, duplicate: true };
  const where = input.lat !== undefined && input.lon !== undefined ? ` Last known location ${input.lat.toFixed(4)}, ${input.lon.toFixed(4)}.` : "";
  const c = await openCase({ bookingId: input.bookingId, channel: "app", severity: 1, summary: `SOS saved offline at ${input.queuedAt}${input.scenario ? `: ${input.scenario}` : ""}.${where}${input.note ? ` Note: ${input.note}` : ""}` }, db);
  await db.insert(s.sosCasesLocalSync).values({ localId: input.localId, caseId: c.id, caseRef: c.caseRef, queuedAt: new Date(input.queuedAt) }).onConflictDoNothing();
  return { caseRef: c.caseRef, duplicate: false };
}

/** Rich rows for the agent's dashboard: who, which trip, where, how it arrived. */
export async function listAlerts(dbIn?: Db) {
  const db = dbIn ?? (await getDb());
  const rows = await db
    .select({ c: s.cases, ref: s.bookings.ref, title: s.itineraries.title, start: s.bookings.startDate, end: s.bookings.endDate, pax: s.bookings.pax, name: s.users.name, phone: s.users.phoneE164 })
    .from(s.cases)
    .leftJoin(s.bookings, eq(s.bookings.id, s.cases.bookingId))
    .leftJoin(s.itineraries, eq(s.itineraries.id, s.bookings.itineraryId))
    .leftJoin(s.users, eq(s.users.id, s.bookings.userId))
    .orderBy(desc(s.cases.createdAt))
    .limit(100);
  return rows.map(({ c, ref, title, start, end, pax, name, phone }) => {
    const loc = c.summary.match(/location (-?\d+\.\d+), (-?\d+\.\d+)/);
    const kind = c.channel === "sms" ? "SMS" : /^SOS/i.test(c.summary) ? "SOS from app" : "Help request";
    return {
      id: c.id, caseRef: c.caseRef, channel: c.channel, kind, severity: c.severity, summary: c.summary, status: c.status, assignedTo: c.assignedTo,
      slaDueAt: c.slaDueAt.toISOString(), createdAt: c.createdAt.toISOString(),
      trip: ref ? { ref, title: title ?? "", start: start ?? "", end: end ?? "", pax: pax ?? 0 } : null,
      traveller: name ? { name, phone: phone ? maskPhone(phone) : null } : null,
      location: loc ? { lat: Number(loc[1]), lon: Number(loc[2]) } : null,
    };
  });
}
