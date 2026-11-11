import { GateError } from "@/lib/gate/errors";

/**
 * Best-effort sliding-window limiter, in memory per server instance.
 * On Vercel each instance has its own counters, so this slows abuse but is not a hard global limit
 * (swap for Upstash/Vercel KV when you add keys).
 */
const hits = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new GateError("RATE_LIMITED", 429, "Too many requests. Please wait a moment.");
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
}
