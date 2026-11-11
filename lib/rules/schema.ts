import { z } from "zod";
import type { Node as EngineNode, Scenario as EngineScenario, Step as EngineStep } from "./engine";
import { SCENARIO_ORDER } from "./scenarios";

/**
 * Rule-set schema (spec section 5.2). The LLM must return JSON that matches this exactly (unknown fields fail).
 * Every phone, address, time or price is a *reference* into the trip data (`ref` or `{{path}}`), never literal text.
 */
export const RULES_SCHEMA_VERSION = 1;
export const RULES_PROMPT_VERSION = "rules-v1";

const Ref = z.string().regex(/^(current|contacts|places|booking)(\.[A-Za-z0-9_]+|\[\d+\])+$/, "ref must point into trip data");
const Action = z.object({ type: z.enum(["call", "show", "map"]), ref: Ref, label: z.string().max(24).optional() }).strict();
const Step = z.object({ text: z.string().min(1).max(260), action: Action.optional() }).strict();
const Ask = z.object({ question: z.string().min(1).max(120), options: z.array(z.object({ label: z.string().max(60), branch: z.string().max(24) }).strict()).min(2).max(4) }).strict();

export type NodeIn = { id: string; label?: string; steps: z.infer<typeof Step>[]; ask?: z.infer<typeof Ask>; branches?: NodeIn[] };
const NodeSchema: z.ZodType<NodeIn> = z.lazy(() =>
  z.object({ id: z.string().max(24), label: z.string().max(60).optional(), steps: z.array(Step).min(1).max(8), ask: Ask.optional(), branches: z.array(NodeSchema).max(4).optional() }).strict(),
);

export const ScenarioSchema = z
  .object({
    id: z.enum(SCENARIO_ORDER),
    title: z.string().min(1).max(40),
    icon: z.string().max(16),
    when: z.string().min(1).max(120),
    severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    sos: z.boolean(),
    steps: z.array(Step).min(1).max(8),
    showCard: z.object({ ref: Ref }).strict().optional(),
    ask: Ask.optional(),
    branches: z.array(NodeSchema).max(4).optional(),
    fallback: z.literal("sos"),
  })
  .strict();
export type ScenarioIn = z.infer<typeof ScenarioSchema>;

export const RuleSetSchema = z
  .object({
    schemaVersion: z.literal(RULES_SCHEMA_VERSION),
    tripId: z.string().max(64),
    generatedBy: z.object({ model: z.string().max(80), promptVersion: z.string().max(24), at: z.string().max(40) }).strict(),
    scenarios: z.array(ScenarioSchema).max(6),
    sourceHash: z.string().max(80),
  })
  .strict();
export type RuleSetIn = z.infer<typeof RuleSetSchema>;

/* ---- conversion to the interpreter's format (steps carry call / show / map) ---- */
const tpl = (ref: string) => `{{${ref}}}`;
function stepToEngine(s: z.infer<typeof Step>): EngineStep {
  const a = s.action;
  return {
    text: s.text,
    ...(a?.type === "call" ? { call: tpl(a.ref), callLabel: a.label ?? "Call" } : {}),
    ...(a?.type === "show" ? { show: tpl(a.ref) } : {}),
    ...(a?.type === "map" ? { map: "hotel" } : {}),
  };
}
function nodeToEngine(n: NodeIn): EngineNode {
  return { id: n.id, label: n.label, steps: n.steps.map(stepToEngine), ask: n.ask, branches: n.branches?.map(nodeToEngine) };
}
export function toEngine(sc: ScenarioIn): EngineScenario {
  const steps = sc.steps.map(stepToEngine);
  if (sc.showCard && !steps.some((s) => s.show)) steps[0] = { ...steps[0], show: tpl(sc.showCard.ref) };
  return { id: sc.id, title: sc.title, icon: sc.icon, when: sc.when, severity: sc.severity, sos: sc.sos, steps, ask: sc.ask, branches: sc.branches?.map(nodeToEngine) };
}
export function toEngineScenarios(rs: RuleSetIn): Record<string, EngineScenario> {
  return Object.fromEntries(rs.scenarios.map((s) => [s.id, toEngine(s)]));
}
