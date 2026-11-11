import { and, count, eq, like } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";

/**
 * Twilio over REST, authenticated with an API Key (SK... + secret) or with Account SID + Auth Token.
 * Message budget: a trial account has a small message allowance, so EVERY outbound send is counted in the database
 * and refused once `TWILIO_SEND_CAP` (default 5) real sends have been made. Reading (polling) inbound messages is free.
 */
export type TwilioConfig = { accountSid: string; user: string; pass: string; from: string };

export function twilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const keySid = process.env.TWILIO_API_KEY_SID, keySecret = process.env.TWILIO_API_KEY_SECRET;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.SMS_GATEWAY_NUMBER;
  if (!accountSid || !from || from.replace(/\D/g, "").replace(/0/g, "") === "") return null;
  if (keySid && keySecret) return { accountSid, user: keySid, pass: keySecret, from };
  if (token) return { accountSid, user: accountSid, pass: token, from };
  return null;
}

const auth = (c: TwilioConfig) => `Basic ${Buffer.from(`${c.user}:${c.pass}`).toString("base64")}`;
export const sendCap = () => Math.max(0, Number(process.env.TWILIO_SEND_CAP ?? 5));

/** How many real messages this app has sent through Twilio so far. */
export async function sentCount(dbIn?: Db) {
  const db = dbIn ?? (await getDb());
  const [{ n }] = await db.select({ n: count() }).from(s.smsMessages).where(and(eq(s.smsMessages.direction, "out"), like(s.smsMessages.providerMessageId, "SM%")));
  return Number(n);
}

export async function twilioSend(to: string, body: string): Promise<{ id: string; stub: boolean; error?: string }> {
  const c = twilioConfig();
  if (!c) return { id: "twilio-unconfigured", stub: true };
  if ((await sentCount()) >= sendCap()) return { id: `capped-${Date.now()}`, stub: true, error: `Send cap reached (${sendCap()} messages). Raise TWILIO_SEND_CAP to send more.` };
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: auth(c), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: c.from, Body: body }),
    signal: AbortSignal.timeout(15000),
  });
  const j = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!res.ok || !j.sid) return { id: `twilio-error-${Date.now()}`, stub: false, error: `Twilio ${res.status}: ${j.message ?? "send failed"}` };
  return { id: j.sid, stub: false };
}

export type TwilioInbound = { sid: string; from: string; body: string; dateSent: string };

/** Read recent INBOUND messages sent to our number (free; sends nothing). */
export async function listInbound(limit = 20): Promise<TwilioInbound[]> {
  const c = twilioConfig();
  if (!c) return [];
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Messages.json?${new URLSearchParams({ To: c.from, PageSize: String(limit) })}`, {
    headers: { Authorization: auth(c) },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Twilio read ${res.status}`);
  const j = (await res.json()) as { messages?: { sid: string; direction: string; from: string; body: string; date_sent: string | null; date_created: string }[] };
  return (j.messages ?? [])
    .filter((m) => m.direction === "inbound" && m.from !== c.from)
    .map((m) => ({ sid: m.sid, from: m.from, body: m.body ?? "", dateSent: new Date(m.date_sent ?? m.date_created).toISOString() }));
}
