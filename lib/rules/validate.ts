import type { OfflinePack } from "@/lib/packs/types";
import { buildContext } from "./context";
import { lookup } from "./engine";
import { RuleSetSchema, type NodeIn, type RuleSetIn, type ScenarioIn } from "./schema";
import { SCENARIO_ORDER } from "./scenarios";

export type RuleData = Pick<OfflinePack, "booking" | "stays" | "places" | "flights" | "contacts">;
export type Check = { check: string; passed: boolean; detail: string };
export const CHECKS = ["schema", "references", "coverage", "no_invented_facts", "length_tone", "local_script", "safety"] as const;

const TPL = /\{\{\s*([\w.[\]]+)\s*\}\}/g;
const stripTpl = (t: string) => t.replace(TPL, " ");

type Walk = { text: string; ref?: string; type?: string; scenario: string }[];
function walkNode(n: NodeIn | ScenarioIn, scenario: string, out: Walk) {
  for (const s of n.steps) {
    out.push({ text: s.text, scenario });
    if (s.action) out.push({ text: "", ref: s.action.ref, type: s.action.type, scenario });
  }
  if (n.ask) { out.push({ text: n.ask.question, scenario }); n.ask.options.forEach((o) => out.push({ text: o.label, scenario })); }
  (n.branches ?? []).forEach((b) => walkNode(b, scenario, out));
}
function collect(rs: RuleSetIn): Walk {
  const out: Walk = [];
  for (const sc of rs.scenarios) {
    out.push({ text: sc.when, scenario: sc.id }, { text: sc.title, scenario: sc.id });
    if (sc.showCard) out.push({ text: "", ref: sc.showCard.ref, type: "showCard", scenario: sc.id });
    walkNode(sc, sc.id, out);
  }
  return out;
}
const stepTexts = (rs: RuleSetIn) => {
  const out: { text: string; scenario: string }[] = [];
  const nodes = (n: NodeIn | ScenarioIn, sc: string) => { n.steps.forEach((s) => out.push({ text: s.text, scenario: sc })); (n.branches ?? []).forEach((b) => nodes(b, sc)); };
  rs.scenarios.forEach((s) => nodes(s, s.id));
  return out;
};

function leaves(v: unknown, out: string[]) {
  if (v == null) return;
  if (typeof v === "string" || typeof v === "number") out.push(String(v));
  else if (Array.isArray(v)) v.forEach((x) => leaves(x, out));
  else if (typeof v === "object") Object.values(v as object).forEach((x) => leaves(x, out));
}

/** Phone numbers, clock times, prices and long digit runs. */
const FACT_RE = /\+?\d[\d ()-]{5,}\d|\b\d{1,2}:\d{2}\b|₹\s?[\d,]+|\b\d{4,}\b/g;

/**
 * The seven validators of spec section 5.3. All must pass before a rule set is stored.
 * `data` is the trip data the rules will run against (the same fields the pack ships).
 */
export function validateRuleSet(raw: unknown, data: RuleData): { ok: boolean; checks: Check[]; ruleSet?: RuleSetIn } {
  const checks: Check[] = [];
  const add = (check: string, passed: boolean, detail = "") => checks.push({ check, passed, detail });

  // 1. schema
  const parsed = RuleSetSchema.safeParse(raw);
  if (!parsed.success) {
    add("schema", false, parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    for (const c of CHECKS.slice(1)) add(c, false, "not run: schema failed");
    return { ok: false, checks };
  }
  add("schema", true);
  const rs = parsed.data;
  const walk = collect(rs);

  // 2. references: every {{…}} and every ref exists in the trip data (for every city the trip visits)
  const ctxs = data.stays.map((st) => buildContext(data as OfflinePack, new Date(`${st.from}T12:00:00Z`), st.city));
  const paths = new Set<string>();
  for (const w of walk) {
    for (const m of w.text.matchAll(TPL)) paths.add(m[1]);
    if (w.ref) paths.add(w.ref);
  }
  const missing = [...paths].filter((p) => ctxs.some((c) => { const v = lookup(c, p); return v === undefined || v === null || v === ""; }));
  add("references", missing.length === 0, missing.length ? `Unknown or empty references: ${missing.slice(0, 5).join(", ")}` : "");

  // 3. coverage: six scenarios, each with a step and a fallback to SOS
  const ids = new Set(rs.scenarios.map((s) => s.id));
  const absent = SCENARIO_ORDER.filter((i) => !ids.has(i));
  const bad = rs.scenarios.filter((s) => s.steps.length < 1 || s.fallback !== "sos");
  add("coverage", absent.length === 0 && bad.length === 0 && rs.scenarios.length === 6, absent.length ? `Missing scenarios: ${absent.join(", ")}` : bad.length ? `No step or SOS fallback: ${bad.map((b) => b.id).join(", ")}` : "");

  // 4. no invented facts: phone numbers, times and prices in text must appear in the trip data
  const allowedList: string[] = [];
  leaves({ booking: data.booking, stays: data.stays, places: data.places, flights: data.flights, contacts: data.contacts }, allowedList);
  for (const c of ctxs) leaves((c as { current?: unknown }).current, allowedList);
  const allowed = allowedList.join(" | ");
  const invented: string[] = [];
  for (const w of walk) for (const m of stripTpl(w.text).matchAll(FACT_RE)) if (!allowed.includes(m[0].trim())) invented.push(`${w.scenario}: "${m[0].trim()}"`);
  add("no_invented_facts", invented.length === 0, invented.length ? `Not in trip data: ${invented.slice(0, 4).join("; ")}` : "");

  // 5. length and tone: at most 20 words per step, plain English, no questions, no pay / cancel / sign instructions
  const toneBad: string[] = [];
  for (const st of stepTexts(rs)) {
    const words = st.text.replace(TPL, "X").split(/\s+/).filter(Boolean).length;
    if (words > 20) toneBad.push(`${st.scenario}: ${words} words`);
    if (st.text.includes("?")) toneBad.push(`${st.scenario}: asks a question`);
    if (/\b(pay|payment|cancel|cancellation|sign)\b/i.test(st.text)) toneBad.push(`${st.scenario}: pay/cancel/sign instruction`);
  }
  add("length_tone", toneBad.length === 0, toneBad.slice(0, 4).join("; "));

  // 6. local script: address cards must come from address_local, never from a model translation
  const scriptBad = walk.filter((w) => w.ref && (w.type === "showCard" || w.type === "show") && /address/.test(w.ref) && !w.ref.endsWith("address_local")).map((w) => `${w.scenario}: ${w.ref}`);
  const cardBad = walk.filter((w) => w.type === "showCard" && !(w.ref ?? "").endsWith("address_local")).map((w) => `${w.scenario}: ${w.ref}`);
  add("local_script", scriptBad.length + cardBad.length === 0, [...scriptBad, ...cardBad].join("; "));

  // 7. safety: medical needs the emergency reference, lost passport needs the consulate, both need SOS
  const uses = (id: string, prefix: string) => walk.some((w) => w.scenario === id && (w.ref?.startsWith(prefix) || [...w.text.matchAll(TPL)].some((m) => m[1].startsWith(prefix))));
  const sos = (id: string) => { const s = rs.scenarios.find((x) => x.id === id); return !!s && s.sos && s.fallback === "sos"; };
  const safetyBad = [
    !uses("medical-help", "current.emergency") && "medical-help has no emergency reference",
    !sos("medical-help") && "medical-help has no SOS fallback",
    !uses("lost-passport", "current.consulate") && "lost-passport has no consulate reference",
    !sos("lost-passport") && "lost-passport has no SOS fallback",
  ].filter(Boolean) as string[];
  add("safety", safetyBad.length === 0, safetyBad.join("; "));

  const ok = checks.every((c) => c.passed);
  return { ok, checks, ruleSet: ok ? rs : undefined };
}
