import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { GateError } from "@/lib/gate/errors";

export const SESSION_COOKIE = "ss_session";
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET || "dev-only-secret-change-me-before-deploying");

export type Session = { uid: string; role: "traveller" | "agent" | "admin"; name: string };

export async function signSession(user: { id: string; role: string; name: string }) {
  return new SignJWT({ role: user.role, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function setSessionCookie(user: { id: string; role: string; name: string }) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signSession(user), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { uid: String(payload.sub), role: payload.role as Session["role"], name: String(payload.name ?? "") };
  } catch {
    return null;
  }
}

export async function requireSession(roles?: Session["role"][]): Promise<Session> {
  const sess = await getSession();
  if (!sess) throw new GateError("UNAUTHENTICATED", 401, "Please sign in.");
  if (roles && !roles.includes(sess.role)) throw new GateError("FORBIDDEN", 403, "You do not have access to that.");
  return sess;
}

export async function getUser(uid: string) {
  const db = await getDb();
  const [u] = await db.select().from(s.users).where(eq(s.users.id, uid)).limit(1);
  return u ?? null;
}
