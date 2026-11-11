/** Offline rule engine: JSON decision trees + {{template}} filling. No model, no network. */
export type Step = { text: string; call?: string; callLabel?: string; show?: string; map?: string };
export type Ask = { question: string; options: { label: string; branch: string }[] };
export type Node = { id: string; label?: string; steps: Step[]; ask?: Ask; branches?: Node[] };
export type Scenario = Node & { title: string; icon: string; when: string; severity: 1 | 2 | 3; sos: boolean };

type Ctx = Record<string, unknown>;
const RE = /\{\{\s*([\w.[\]]+)\s*\}\}/g;
export const MISSING = "(not in your booking)";

export function lookup(ctx: Ctx, path: string): unknown {
  return path.split(/[.[\]]+/).filter(Boolean).reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Ctx)[k] : undefined), ctx);
}

export function fill(tpl: string | undefined, ctx: Ctx, onMissing?: (p: string) => void): string | undefined {
  if (tpl === undefined) return undefined;
  return tpl.replace(RE, (_, p: string) => {
    const v = lookup(ctx, p);
    if (v === undefined || v === null || v === "") {
      onMissing?.(p);
      return MISSING;
    }
    return String(v);
  });
}

function fillNode(n: Node, ctx: Ctx, miss?: (p: string) => void): Node {
  const f = (t?: string) => fill(t, ctx, miss);
  return {
    ...n,
    label: f(n.label),
    steps: n.steps.map((s) => ({ text: f(s.text)!, call: f(s.call), callLabel: s.callLabel, show: f(s.show), map: s.map })),
    ask: n.ask && { question: f(n.ask.question)!, options: n.ask.options.map((o) => ({ ...o, label: f(o.label)! })) },
    branches: n.branches?.map((b) => fillNode(b, ctx, miss)),
  };
}

export function resolve(sc: Scenario, ctx: Ctx, miss?: (p: string) => void): Scenario {
  return { ...(fillNode(sc, ctx, miss) as Scenario), title: sc.title, when: fill(sc.when, ctx, miss)! };
}

/** Follow `answers` (branch ids) down the tree; returns the steps shown so far and the next question, if any. */
export function walk(root: Node, answers: string[]) {
  const steps: Step[] = [...root.steps];
  let node = root;
  for (const a of answers) {
    const next = node.branches?.find((b) => b.id === a);
    if (!next) break;
    node = next;
    steps.push(...next.steps);
  }
  return { node, steps, ask: node.ask };
}

/** Every {{path}} used in a scenario (for tests: all must resolve against a real pack). */
export function templatePaths(n: Node): string[] {
  const own = [n.label, ...n.steps.flatMap((s) => [s.text, s.call, s.show]), n.ask?.question, ...(n.ask?.options.map((o) => o.label) ?? [])]
    .filter(Boolean)
    .flatMap((t) => [...(t as string).matchAll(RE)].map((m) => m[1]));
  return [...own, ...(n.branches?.flatMap(templatePaths) ?? [])];
}
