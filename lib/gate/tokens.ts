import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_TTL_MS = 5 * 60 * 1000;
export const QUOTE_TTL_MS = 15 * 60 * 1000;

/** Random single-use token. Only its hash is ever stored. */
export function mintToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export type QuoteCore = {
  bookingId: string;
  kind: string;
  params: Record<string, unknown>;
  before: unknown;
  after: unknown;
  priceDeltaInr: number;
  breakup?: unknown;
};

/** Hash that binds a confirmation to exactly what the traveller saw on the review card. */
export function quoteHash(q: QuoteCore): string {
  return createHash("sha256").update(canon({ b: q.bookingId, k: q.kind, p: q.params, be: q.before, af: q.after, d: q.priceDeltaInr, br: q.breakup ?? [] })).digest("hex");
}
