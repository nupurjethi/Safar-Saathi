import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { GateError } from "@/lib/gate/errors";
import { hashPassword, passwordProblem, verifyPassword } from "./password";

export const normaliseEmail = (e: string) => e.trim().toLowerCase();
const BAD_LOGIN = "That email and password do not match. Check them and try again.";

/** Creates a travel-user account (role traveller, never staff) with a hashed password. */
export async function registerUser(input: { name: string; email: string; password: string }, dbIn?: Db) {
  const db = dbIn ?? (await getDb());
  const email = normaliseEmail(input.email);
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 60);
  if (name.length < 2) throw new GateError("BAD_REQUEST", 400, "Enter your name.");
  const problem = passwordProblem(input.password, email);
  if (problem) throw new GateError("BAD_REQUEST", 400, problem);
  const [existing] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, email)).limit(1);
  if (existing) throw new GateError("EMAIL_TAKEN", 409, "An account with this email already exists. Sign in instead.");
  const passwordHash = await hashPassword(input.password);
  const [u] = await db.insert(s.users).values({ email, name, passwordHash, role: "traveller", isDemo: false }).returning();
  await db.insert(s.events).values({ name: "account_created", userId: u.id, props: { method: "password" } });
  return u;
}

/** Checks an email and password. One generic error for every failure (no account, no password set, wrong password, staff account). */
export async function loginWithPassword(input: { email: string; password: string }, dbIn?: Db) {
  const db = dbIn ?? (await getDb());
  const [u] = await db.select().from(s.users).where(eq(s.users.email, normaliseEmail(input.email))).limit(1);
  const ok = await verifyPassword(input.password, u?.passwordHash);
  if (!u || !ok || u.role !== "traveller") throw new GateError("UNAUTHENTICATED", 401, BAD_LOGIN);
  return u;
}
