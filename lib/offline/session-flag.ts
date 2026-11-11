"use client";
/**
 * A tiny local note of who is signed in, so the app behaves as signed in with no network (the real session is an httpOnly
 * cookie the page cannot read). It is set whenever the server confirms the session, and cleared on logout or when the server
 * says the session is gone. It carries no secret: name and role only.
 */
export type Remembered = { id: string; name: string; role: "traveller" | "agent" | "admin" };
const KEY = "ss-user";
export function rememberedUser(): Remembered | null {
  try { const v = localStorage.getItem(KEY); return v ? (JSON.parse(v) as Remembered) : null; } catch { return null; }
}
export function rememberUser(u: Remembered | null) {
  try { if (u) localStorage.setItem(KEY, JSON.stringify({ id: u.id, name: u.name, role: u.role })); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
