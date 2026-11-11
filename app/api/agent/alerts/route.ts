import { handle, json } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { listAlerts } from "@/lib/server/cases";
import { pollTwilio } from "@/lib/sms/poll";
import { sentCount, sendCap, twilioConfig } from "@/lib/sms/twilio";

export const dynamic = "force-dynamic";
/**
 * The agent dashboard's feed. Every call first checks Twilio for new inbound texts (throttled to one check per ~8 s,
 * and free), then returns the alerts. Staff only.
 */
export const GET = handle(async () => {
  const sess = await requireSession(["agent", "admin"]);
  const poll = await pollTwilio();
  const cases = await listAlerts();
  const live = process.env.SMS_PROVIDER === "twilio" && !!twilioConfig();
  return json({
    now: new Date().toISOString(), me: { name: sess.name, role: sess.role }, cases,
    sms: { provider: live ? "twilio" : "simulator", number: live ? process.env.SMS_GATEWAY_NUMBER : null, lastPoll: poll.at, pollError: poll.error ?? null, sent: live ? await sentCount() : 0, cap: live ? sendCap() : 0 },
  });
});
