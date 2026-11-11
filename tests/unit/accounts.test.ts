import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/server/password";
import { loginWithPassword, registerUser } from "@/lib/server/accounts";
import { verifyCode } from "@/lib/server/otp";
import { GateError } from "@/lib/gate/errors";
import { setupDb } from "./helpers";

beforeAll(async () => { await setupDb(); });

describe("password hashing", () => {
  it("is salted, verifiable and never stores the password", async () => {
    const a = await hashPassword("correct horse 42"), b = await hashPassword("correct horse 42");
    expect(a).not.toBe(b); // random salt
    expect(a).not.toContain("correct horse");
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse 42", a)).toBe(true);
    expect(await verifyPassword("correct horse 43", a)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });
  it("rejects weak passwords with a plain message", () => {
    expect(passwordProblem("short")).toMatch(/8 characters/);
    expect(passwordProblem("password1")).toMatch(/common/);
    expect(passwordProblem("aaaaaaaaa")).toMatch(/repeated/);
    expect(passwordProblem("me@example.com", "me@example.com")).toMatch(/email/);
    expect(passwordProblem("a fine passphrase")).toBeNull();
  });
});

describe("email + password accounts", () => {
  it("creates a travel user, then signs in; the hash is stored, the password is not", async () => {
    const u = await registerUser({ name: "  Ravi   Kumar ", email: "Ravi.K@Example.com", password: "monsoon-2026!" });
    expect(u.email).toBe("ravi.k@example.com");
    expect(u.name).toBe("Ravi Kumar");
    expect(u.role).toBe("traveller");
    expect(u.isDemo).toBe(false);
    const db = await getDb();
    const [row] = await db.select().from(s.users).where(eq(s.users.id, u.id));
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(row)).not.toContain("monsoon-2026!");
    const again = await loginWithPassword({ email: "RAVI.K@example.com", password: "monsoon-2026!" });
    expect(again.id).toBe(u.id);
  });
  it("refuses a duplicate email and a weak password", async () => {
    await expect(registerUser({ name: "Ravi", email: "ravi.k@example.com", password: "another-pass-1" })).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    await expect(registerUser({ name: "Sana", email: "sana@example.com", password: "short" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(registerUser({ name: "S", email: "sana@example.com", password: "long-enough-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("gives one generic error for a wrong password, an unknown email, a demo account and a staff account", async () => {
    const msgs = new Set<string>();
    for (const input of [
      { email: "ravi.k@example.com", password: "wrong-password" },
      { email: "nobody@example.com", password: "monsoon-2026!" },
      { email: "neha@demo.safarsaathi.test", password: "anything-at-all" }, // demo accounts have no password
      { email: "asha@demo.safarsaathi.test", password: "anything-at-all" }, // staff cannot use this door
    ]) {
      const e = await loginWithPassword(input).catch((x) => x);
      expect(e).toBeInstanceOf(GateError);
      expect((e as GateError).status).toBe(401);
      msgs.add((e as GateError).message);
    }
    expect(msgs.size).toBe(1);
  });
  it("an on-screen email code cannot open a password account while no email key is set", async () => {
    const db = await getDb();
    const crypto = await import("node:crypto");
    const code = "123456";
    await db.insert(s.loginCodes).values({ email: "ravi.k@example.com", codeHash: crypto.createHash("sha256").update(`ravi.k@example.com:${code}`).digest("hex"), expiresAt: new Date(Date.now() + 60_000) });
    await expect(verifyCode("ravi.k@example.com", code)).rejects.toThrow(/uses a password/);
  });
});
