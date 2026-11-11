import { z } from "zod";
import { handle, json, readJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { registerUser } from "@/lib/server/accounts";
import { setSessionCookie } from "@/lib/server/session";

export const dynamic = "force-dynamic";
/** Create a travel-user account with email + password and sign in. */
export const POST = handle(async (req: Request) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  rateLimit(`reg:${ip}`, 10, 60 * 60_000);
  const b = await readJson(req, z.object({ name: z.string().min(2).max(60), email: z.string().email().max(120), password: z.string().min(1).max(128) }));
  const u = await registerUser(b);
  await setSessionCookie(u);
  return json({ user: { id: u.id, name: u.name, role: u.role } }, 201);
});
