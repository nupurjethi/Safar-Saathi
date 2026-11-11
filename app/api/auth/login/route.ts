import { z } from "zod";
import { handle, json, readJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { loginWithPassword, normaliseEmail } from "@/lib/server/accounts";
import { setSessionCookie } from "@/lib/server/session";

export const dynamic = "force-dynamic";
/** Sign in a travel user with email + password. */
export const POST = handle(async (req: Request) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const b = await readJson(req, z.object({ email: z.string().email().max(120), password: z.string().min(1).max(128) }));
  rateLimit(`login:ip:${ip}`, 30, 10 * 60_000);
  rateLimit(`login:${normaliseEmail(b.email)}`, 8, 10 * 60_000); // slows guessing one account
  const u = await loginWithPassword(b);
  await setSessionCookie(u);
  return json({ user: { id: u.id, name: u.name, role: u.role } });
});
