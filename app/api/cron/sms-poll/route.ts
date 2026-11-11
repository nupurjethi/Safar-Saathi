import { handle, json } from "@/lib/server/http";
import { pollTwilio } from "@/lib/sms/poll";
import { GateError } from "@/lib/gate/errors";

export const dynamic = "force-dynamic";
/** Optional scheduler hook (Vercel Cron): read new inbound Twilio texts even when no dashboard is open. */
export const GET = handle(async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) throw new GateError("FORBIDDEN", 403, "Bad cron secret.");
  return json(await pollTwilio({ force: true }));
});
