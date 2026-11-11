import { purgeOldSms } from "@/lib/sms/inbound";
import { handle, json } from "@/lib/server/http";
import { GateError } from "@/lib/gate/errors";

export const dynamic = "force-dynamic";
/** Vercel Cron: deletes SMS bodies older than SMS_RETENTION_DAYS (default 30). */
export const GET = handle(async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) throw new GateError("FORBIDDEN", 403, "Not allowed.");
  return json({ purgedSms: await purgeOldSms() });
});
