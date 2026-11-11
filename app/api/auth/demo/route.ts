import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { setSessionCookie } from "@/lib/server/session";
import { handle, json } from "@/lib/server/http";
import { GateError } from "@/lib/gate/errors";

export const dynamic = "force-dynamic";
const EMAILS = { traveller: "neha@demo.safarsaathi.test", agent: "asha@demo.safarsaathi.test", admin: "admin@demo.safarsaathi.test" } as const;

async function loginAs(role: keyof typeof EMAILS) {
  if (process.env.DEMO_MODE === "false") throw new GateError("FORBIDDEN", 403, "Demo login is turned off.");
  const db = await getDb();
  const [u] = await db.select().from(s.users).where(eq(s.users.email, EMAILS[role])).limit(1);
  if (!u) throw new GateError("NOT_FOUND", 404, "Demo data is not seeded yet. Run npm run db:reset.");
  await setSessionCookie(u);
  return u;
}

export const POST = handle(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as { role?: keyof typeof EMAILS };
  const u = await loginAs(body.role && body.role in EMAILS ? body.role : "traveller");
  return json({ user: { id: u.id, name: u.name, role: u.role } });
});

/** Convenience for demo links: /api/auth/demo?role=admin&next=/admin/cases */
export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const role = (url.searchParams.get("role") ?? "traveller") as keyof typeof EMAILS;
  await loginAs(role in EMAILS ? role : "traveller");
  const next = url.searchParams.get("next") ?? "/trips";
  return NextResponse.redirect(new URL(next.startsWith("/") ? next : "/trips", url.origin));
});
