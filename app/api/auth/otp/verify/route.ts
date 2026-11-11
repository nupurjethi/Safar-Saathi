import { z } from "zod";
import { handle, json, readJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { verifyCode } from "@/lib/server/otp";
import { setSessionCookie } from "@/lib/server/session";

export const POST = handle(async (req: Request) => {
  const { email, code } = await readJson(req, z.object({ email: z.string().email().max(120), code: z.string().regex(/^\d{6}$/) }));
  rateLimit(`otpv:${email.toLowerCase()}`, 10, 10 * 60_000);
  const u = await verifyCode(email, code);
  await setSessionCookie(u);
  return json({ user: { id: u.id, name: u.name, role: u.role } });
});
