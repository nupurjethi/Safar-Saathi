import type { OfflinePack } from "@/lib/packs/types";
import { currentStay } from "@/lib/rules/context";
import { build, guidance, lowAnswer, type Env } from "./answers";
import { extract } from "./extract";
import { exampleFor, scoreIntents } from "./intents";
import { normalize } from "./text";
import type { IntentId, OaAnswer } from "./types";

export * from "./types";
export { INTENTS } from "./intents";

export const QUICK_QUESTIONS = ["Where is my hotel?", "When is my airport pickup?", "What is my plan for today?", "What are my flight details?", "What is the police number?", "My passport is lost", "My flight is delayed", "How do I send an SOS?", "Do I need to tip?"];

const MIN = 4; // below this a question is "not understood"
const MIN_SOFT = 3; // greetings and thanks are allowed to be weak

/**
 * Answers a question from the saved pack only: no network, no model. Deterministic and instant.
 * Never changes anything: booking changes are answered with "needs a connection and your Confirm tap".
 */
export function answerOffline(pack: OfflinePack, question: string, opts: { now?: Date; city?: string } = {}): OaAnswer {
  const now = opts.now ?? new Date();
  const q = normalize(question);
  const ent = extract(pack, question, now);
  const stay = currentStay(pack, now, opts.city ?? ent.city);
  const env: Env = { pack, now, stay, ent, question, answers: [] };
  if (!q) return finish(build(env, "help"), 0.5, []);
  const scored = scoreIntents(question);
  const top = scored[0];
  const soft = top && (top.id === "help" || top.id === "thanks");
  if (!top || top.score < (soft ? MIN_SOFT : MIN)) {
    // a place from the trip with no other intent: tell them where it is on the plan
    if (ent.flight) return finish(build(env, "flights"), 0.7, []);
    if (ent.place) return finish(build(env, "routes"), 0.6, []);
    return lowAnswer(question, scored.slice(0, 2).map((s) => s.id));
  }
  // a named place beats the generic "how do I get / where is" questions
  const id: IntentId = top.id === "routes" || (ent.place && top.id === "today" && /where|kahan|how|route/.test(q)) ? "routes" : top.id;
  const alts = scored.slice(1).filter((s) => s.id !== id && s.score >= top.score - 1.5 && s.score >= MIN).slice(0, 2);
  const conf = Math.min(0.99, 0.45 + top.score / 16 - (alts.length ? 0.1 : 0));
  return finish(build(env, id), conf, alts.map((s) => s.id));
}

function finish(a: OaAnswer, confidence: number, alts: IntentId[]): OaAnswer {
  a.confidence = Math.round(confidence * 100) / 100;
  a.alternatives = alts.map((i) => ({ intent: i, question: exampleFor(i) })).filter((x) => x.question);
  return a;
}

/** Re-walks a frozen scenario after the traveller taps an answer option (the decision tree). Offline, instant. */
export function walkScenario(pack: OfflinePack, scenarioId: string, answers: string[], opts: { now?: Date; city?: string } = {}): OaAnswer | null {
  const now = opts.now ?? new Date();
  const stay = currentStay(pack, now, opts.city);
  const a = guidance({ pack, now, stay, ent: {}, question: "", answers }, scenarioId);
  return a;
}
