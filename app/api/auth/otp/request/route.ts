import { z } from "zod";
import { handle, json, readJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { requestCode } from "@/lib/server/otp";

export const POST = handle(async (req: Request) => {
  const { email } = await readJson(req, z.object({ email: z.string().email().max(120) }));
  rateLimit(`otp:${email.toLowerCase()}`, 5, 10 * 60_000);
  return json(await requestCode(email));
});
