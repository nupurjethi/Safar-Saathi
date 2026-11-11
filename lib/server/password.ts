import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const N = 16384, R = 8, P = 1, KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

/** scrypt with a random 16-byte salt. Format: scrypt$N$r$p$salt$hash (base64). No dependency, memory-hard. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  // A missing hash still costs one scrypt run, so "no such account" and "wrong password" take the same time.
  const parts = (stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    await scrypt(password.normalize("NFKC"), Buffer.alloc(16), KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
    return false;
  }
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "base64");
  const got = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const COMMON = new Set(["password", "password1", "12345678", "123456789", "1234567890", "qwerty123", "iloveyou", "11111111", "abc12345", "welcome1", "letmein123", "safarsaathi"]);
/** Returns a plain-English problem, or null when the password is acceptable. */
export function passwordProblem(password: string, email = ""): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (password.length > 128) return "Use at most 128 characters.";
  if (COMMON.has(password.toLowerCase())) return "That password is too common. Pick another.";
  if (email && password.toLowerCase() === email.toLowerCase()) return "Your password cannot be your email.";
  if (/^(.)\1+$/.test(password)) return "Use more than one repeated character.";
  return null;
}
