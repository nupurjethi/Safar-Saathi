import { handleInboundSms } from "@/lib/sms/inbound";
import { getSmsAdapter } from "@/lib/sms/adapter";
import { handle } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { GateError } from "@/lib/gate/errors";

export const dynamic = "force-dynamic";
/** Gateway webhook (Twilio-style form POST). The signature is verified by the active adapter. */
export const POST = handle(async (req: Request) => {
  const raw = await req.text();
  if (raw.length > 5000) throw new GateError("BAD_REQUEST", 413, "Too large.");
  const adapter = getSmsAdapter();
  const msg = await adapter.parseInbound(req, raw);
  if (!msg) throw new GateError("FORBIDDEN", 403, "Bad signature or payload.");
  rateLimit(`sms:${msg.from}`, 10, 60_000);
  const r = await handleInboundSms(msg);
  // Twilio expects TwiML or empty 200. We reply through the adapter, so return an empty TwiML document.
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response/>`, { headers: { "Content-Type": "text/xml", "X-Case": r.caseRef ?? "" } });
});
