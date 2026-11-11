/** Tiny text toolkit: normalising, tokenising and typo-tolerant phrase matching (no dependencies). */

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9ऀ-ॿ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const tokens = (s: string) => normalize(s).split(" ").filter(Boolean);

/** Edit distance (Damerau-ish: adjacent swaps count as 1), capped for speed. */
export function lev(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, (prev2[j - 2] ?? 99) + 1);
      cur[j] = v;
    }
    prev2.splice(0, prev2.length, ...prev);
    prev = cur;
  }
  return prev[b.length];
}

/** Does question token `t` match pattern token `p`? `p` may end in "*" (prefix) and tolerates typos when long enough. */
export function tokMatch(t: string, p: string): boolean {
  if (p.startsWith("=")) return t === p.slice(1); // exact word only (no typo tolerance)
  if (p.endsWith("*")) return t.startsWith(p.slice(0, -1));
  if (t === p) return true;
  if (/^\d+$/.test(p) || /^\d+$/.test(t)) return false;
  if (t.length < 5) return false; // short question words must match exactly (plan is not plane)
  if (p.length >= 8) return lev(t, p, 2) <= 2;
  if (p.length >= 5) return lev(t, p, 1) <= 1;
  return false;
}

/** Matches a phrase (already tokenised) against the question tokens, in order and adjacent. Returns its token count or 0. */
export function phraseMatch(qt: string[], phrase: string[]): number {
  for (let i = 0; i + phrase.length <= qt.length; i++) {
    let ok = true;
    for (let j = 0; j < phrase.length; j++) if (!tokMatch(qt[i + j], phrase[j])) { ok = false; break; }
    if (ok) return phrase.length;
  }
  return 0;
}

/** Tokenises a rule phrase, keeping a trailing "*" (prefix wildcard) on a word. */
export function patternTokens(p: string): string[] {
  return p.split(/\s+/).filter(Boolean).map((w) => {
    const star = w.endsWith("*");
    const exact = w.startsWith("=");
    const n = normalize(w).replace(/\s+/g, "");
    return (exact ? "=" : "") + n + (star ? "*" : "");
  }).filter((w) => w && w !== "*");
}
