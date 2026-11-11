import { createHmac } from "node:crypto";
import { twilioSend } from "./twilio";

export type InboundSms = { from: string; body: string; messageId: string };
export interface SmsAdapter {
  name: "sim" | "twilio" | "msg91";
  send(to: string, body: string): Promise<{ id: string; stub: boolean }>;
  /** Verify the gateway signature and parse the inbound webhook. Returns null when the signature is bad. */
  parseInbound(req: Request, rawBody: string): Promise<InboundSms | null>;
}

const simAdapter: SmsAdapter = {
  name: "sim",
  async send() {
    return { id: `sim-${Date.now()}`, stub: true }; // nothing leaves the server; the row in sms_messages is the "delivery"
  },
  async parseInbound(_req, raw) {
    const p = new URLSearchParams(raw);
    const from = p.get("From"), body = p.get("Body"), id = p.get("MessageSid");
    return from && body ? { from, body, messageId: id ?? `sim-in-${Date.now()}` } : null;
  },
};

/** Twilio: REST send (API key or auth token, capped, see lib/sms/twilio.ts) + X-Twilio-Signature check for the webhook (needs TWILIO_AUTH_TOKEN and PUBLIC_URL). Inbound is normally read by polling (lib/sms/poll.ts). */
const twilioAdapter: SmsAdapter = {
  name: "twilio",
  async send(to, body) {
    const r = await twilioSend(to, body);
    if (r.error) console.warn(`[sms] ${r.error}`);
    return { id: r.id, stub: r.stub };
  },
  async parseInbound(req, raw) {
    const tok = process.env.TWILIO_AUTH_TOKEN;
    if (!tok) return null; // an API key cannot verify webhook signatures: use polling, or set TWILIO_AUTH_TOKEN
    const params = new URLSearchParams(raw);
    const url = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/api/sms/inbound` : req.url;
    const data = url + [...params.keys()].sort().map((k) => k + params.get(k)).join("");
    const sig = createHmac("sha1", tok).update(data).digest("base64");
    if (sig !== req.headers.get("x-twilio-signature")) return null;
    const from = params.get("From"), body = params.get("Body"), id = params.get("MessageSid");
    return from && body && id ? { from, body, messageId: id } : null;
  },
};

/** MSG91 (India DLT route): STUB. Adapter shape is here so the swap is one file. */
const msg91Adapter: SmsAdapter = {
  name: "msg91",
  async send() {
    return { id: "msg91-stub", stub: true }; // STUB: needs DLT-registered sender + template (Phase 2)
  },
  async parseInbound() {
    return null; // STUB
  },
};

export function getSmsAdapter(): SmsAdapter {
  const p = process.env.SMS_PROVIDER ?? "sim";
  return p === "twilio" ? twilioAdapter : p === "msg91" ? msg91Adapter : simAdapter;
}
