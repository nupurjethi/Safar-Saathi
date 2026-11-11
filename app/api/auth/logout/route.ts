import { clearSessionCookie } from "@/lib/server/session";
import { handle, json } from "@/lib/server/http";

export const POST = handle(async () => {
  await clearSessionCookie();
  return json({ ok: true });
});
