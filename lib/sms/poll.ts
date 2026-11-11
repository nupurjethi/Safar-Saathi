import { and, eq } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { handleInboundSms } from "./inbound";
import { listInbound, twilioConfig, type TwilioInbound } from "./twilio";

/**
 * "Read the SMS from Twilio": a local machine has no public webhook URL, so the server asks Twilio for new inbound
 * messages instead (free read). Each new message goes through the same handler as the webhook: severity rubric, a case in
 * the agent's dashboard, and (budget permitting) a short reply. Idempotent by Twilio's message SID.
 */
const MIN_GAP_MS = 8000;
const g = globalThis as unknown as { __ssPoll?: { at: number; running?: Promise<PollResult> } };
export type PollResult = { enabled: boolean; checked: number; created: number; error?: string; at: string };

async function since(db: Db): Promise<Date> {
  if (process.env.SMS_POLL_SINCE) return new Date(process.env.SMS_POLL_SINCE);
  const [e] = await db.select().from(s.events).where(eq(s.events.name, "sms_poll_started")).limit(1);
  if (e) return e.createdAt;
  await db.insert(s.events).values({ name: "sms_poll_started", props: {} });
  return new Date(Date.now() - 15 * 60_000); // texts sent in the 15 minutes before the first poll still count
}

export async function processInbound(db: Db, msgs: TwilioInbound[], from: Date) {
  let created = 0;
  for (const m of msgs.slice().sort((a, b) => a.dateSent.localeCompare(b.dateSent))) {
    if (new Date(m.dateSent) < from) continue;
    const seen = await db.select({ id: s.smsMessages.id }).from(s.smsMessages).where(and(eq(s.smsMessages.providerMessageId, m.sid), eq(s.smsMessages.direction, "in"))).limit(1);
    if (seen.length) continue;
    await handleInboundSms({ from: m.from, body: m.body, messageId: m.sid }, db);
    created++;
  }
  return created;
}

export async function pollTwilio(opts: { force?: boolean } = {}, dbIn?: Db): Promise<PollResult> {
  const at = new Date().toISOString();
  if (process.env.SMS_PROVIDER !== "twilio" || !twilioConfig()) return { enabled: false, checked: 0, created: 0, at };
  const st = (g.__ssPoll ??= { at: 0 });
  if (st.running) return st.running;
  if (!opts.force && Date.now() - st.at < MIN_GAP_MS) return { enabled: true, checked: 0, created: 0, at };
  st.at = Date.now();
  st.running = (async () => {
    try {
      const db = dbIn ?? (await getDb());
      const msgs = await listInbound(20);
      const created = await processInbound(db, msgs, await since(db));
      return { enabled: true, checked: msgs.length, created, at };
    } catch (e) {
      return { enabled: true, checked: 0, created: 0, error: e instanceof Error ? e.message : String(e), at };
    } finally {
      st.running = undefined;
    }
  })();
  return st.running;
}
