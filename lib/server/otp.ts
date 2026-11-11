import { createHash, randomInt } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { GateError } from "@/lib/gate/errors";

const hash = (email: string, code: string) => createHash("sha256").update(`${email.toLowerCase()}:${code}`).digest("hex");

/** Sends the code via Resend when RESEND_API_KEY is set. STUB otherwise: the code is printed to the server log. */
export async function requestCode(email: string) {
  const db = await getDb();
  const code = String(randomInt(100000, 1000000));
  await db.insert(s.loginCodes).values({ email: email.toLowerCase(), codeHash: hash(email, code), expiresAt: new Date(Date.now() + 10 * 60_000) });
  const key = process.env.RESEND_API_KEY;
  if (key) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "Safar Saathi <onboarding@resend.dev>", to: email, subject: "Your Safar Saathi sign-in code", text: `Your code is ${code}. It works for 10 minutes.` }),
    });
    if (!res.ok) throw new GateError("BAD_REQUEST", 502, "We could not send the email. Try again.");
    return { sent: true, stub: false as const };
  }
  console.log(`[STUB email] sign-in code for ${email.replace(/(.).+(@.*)/, "$1***$2")}: ${code}`);
  return { sent: true, stub: true as const, devCode: process.env.NODE_ENV === "production" ? undefined : code };
}

export async function verifyCode(email: string, code: string) {
  const db = await getDb();
  const [row] = await db.select().from(s.loginCodes).where(and(eq(s.loginCodes.email, email.toLowerCase()), isNull(s.loginCodes.usedAt))).orderBy(desc(s.loginCodes.createdAt)).limit(1);
  if (!row || row.expiresAt.getTime() < Date.now() || row.attempts >= 5) throw new GateError("TOKEN_INVALID", 401, "That code is not valid. Ask for a new one.");
  await db.update(s.loginCodes).set({ attempts: row.attempts + 1 }).where(eq(s.loginCodes.id, row.id));
  if (row.codeHash !== hash(email, code)) throw new GateError("TOKEN_INVALID", 401, "That code is not right.");
  await db.update(s.loginCodes).set({ usedAt: new Date() }).where(eq(s.loginCodes.id, row.id));
  const [existing] = await db.select().from(s.users).where(eq(s.users.email, email.toLowerCase())).limit(1);
  // With no email key the code is shown on screen/log, so it proves nothing: never let it open a password account.
  if (existing?.passwordHash && !process.env.RESEND_API_KEY) throw new GateError("TOKEN_INVALID", 401, "This account uses a password. Sign in with your email and password.");
  if (existing) return existing;
  const [u] = await db.insert(s.users).values({ email: email.toLowerCase(), name: email.split("@")[0], role: "traveller" }).returning();
  return u;
}
