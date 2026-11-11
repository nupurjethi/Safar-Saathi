import { getSession, getUser } from "@/lib/server/session";
import { handle, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const GET = handle(async () => {
  const sess = await getSession();
  if (!sess) return json({ user: null });
  const u = await getUser(sess.uid);
  return json({ user: u && { id: u.id, name: u.name, role: u.role, email: u.email, isDemo: u.isDemo } });
});
