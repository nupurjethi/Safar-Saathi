import { getSession, getUser, setSessionCookie } from "@/lib/server/session";
import { handle, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const GET = handle(async () => {
  const sess = await getSession();
  if (!sess) return json({ user: null });
  const u = await getUser(sess.uid);
  // Stay signed in until the traveller logs out: every few days of use the cookie is renewed for another year.
  if (u && sess.iat && Date.now() / 1000 - sess.iat > 3 * 86400) await setSessionCookie(u);
  return json({ user: u && { id: u.id, name: u.name, role: u.role, email: u.email, isDemo: u.isDemo } });
});
