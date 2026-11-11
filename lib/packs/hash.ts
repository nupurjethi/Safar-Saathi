/** Isomorphic helpers (browser + Node): the server stamps contentHash, the phone re-verifies it. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const d = await crypto.subtle.digest("SHA-256", buf);
  return "sha256:" + [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Recompute a pack's content hash (everything except packVersion, contentHash, builtAt). */
export async function packContentHash(pack: Record<string, unknown>): Promise<string> {
  const { packVersion: _v, contentHash: _h, builtAt: _b, ...content } = pack; // eslint-disable-line @typescript-eslint/no-unused-vars
  return sha256Hex(stableStringify(content));
}
