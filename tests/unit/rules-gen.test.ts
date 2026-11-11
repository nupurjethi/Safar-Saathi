import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupDb } from "./helpers";
import * as s from "@/lib/db/schema";
import { __setLlmDrafter, type LlmRequest } from "@/lib/llm";
import { buildPackContent, getLatestPack } from "@/lib/packs/build";
import type { OfflinePack } from "@/lib/packs/types";
import { LABEL_LLM, LABEL_TEMPLATE, resolveRules, scenarioDeps, templateScenario } from "@/lib/rules/generate";
import { SCENARIO_ORDER } from "@/lib/rules/scenarios";
import type { RuleSetIn } from "@/lib/rules/schema";
import { validateRuleSet, type RuleData } from "@/lib/rules/validate";

type Ctx = Awaited<ReturnType<typeof setupDb>>;
let c: Ctx;
let data: RuleData;
let valid: RuleSetIn;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

beforeAll(async () => {
  c = await setupDb();
  data = (await getLatestPack(c.booking.id))!.pack as OfflinePack;
  valid = (data as OfflinePack).ruleSet;
});
afterEach(() => __setLlmDrafter(null));

const fails = (rs: unknown, check: string) => {
  const v = validateRuleSet(rs, data);
  expect(v.ok).toBe(false);
  expect(v.checks.find((x) => x.check === check)?.passed, `${check}: ${JSON.stringify(v.checks.filter((x) => !x.passed))}`).toBe(false);
};
const withStep = (text: string, id = "flight-delayed") => { const rs = clone(valid); rs.scenarios.find((x) => x.id === id)!.steps[0].text = text; return rs; };

describe("rule-set validation (spec 5.3)", () => {
  it("a valid rule set passes all seven checks", () => {
    const v = validateRuleSet(valid, data);
    expect(v.checks.map((x) => x.check)).toEqual(["schema", "references", "coverage", "no_invented_facts", "length_tone", "local_script", "safety"]);
    expect(v.ok).toBe(true);
  });
  it("unknown fields fail the schema", () => { const rs = clone(valid) as unknown as { scenarios: Record<string, unknown>[] }; rs.scenarios[0].extra = 1; fails(rs, "schema"); });
  it("a missing scenario fails coverage", () => { const rs = clone(valid); rs.scenarios = rs.scenarios.filter((x) => x.id !== "medical-help"); fails(rs, "coverage"); });
  it("an invented phone number fails", () => fails(withStep("Call the airline on +91 98765 43210 now."), "no_invented_facts"));
  it("an invented time or price fails", () => { fails(withStep("Your pickup is at 23:47 tonight."), "no_invented_facts"); fails(withStep("The fee is ₹12,345 today."), "no_invented_facts"); });
  it("a phone number that IS in the trip data passes", () => expect(validateRuleSet(withStep(`Call ${data.contacts.airline_phone} for help.`), data).checks.find((x) => x.check === "no_invented_facts")!.passed).toBe(true));
  it("a reference to a field that does not exist fails", () => fails(withStep("Call {{current.hotel.fax}} please."), "references"));
  it("a step over 20 words, a question, or a pay / cancel / sign instruction fails", () => {
    fails(withStep(Array(21).fill("word").join(" ")), "length_tone");
    fails(withStep("Do you have your ticket?"), "length_tone");
    fails(withStep("Pay the airline desk first."), "length_tone");
    fails(withStep("Sign the form at the desk."), "length_tone");
  });
  it("an address card that is not from address_local fails", () => {
    const rs = clone(valid); const sc = rs.scenarios.find((x) => x.id === "hotel-not-found")!; sc.showCard = { ref: "current.hotel.address" }; fails(rs, "local_script");
  });
  it("medical help without an emergency reference fails the safety check", () => {
    const rs = clone(valid); const sc = rs.scenarios.find((x) => x.id === "medical-help")!;
    sc.steps = [{ text: "Stay calm and rest." }]; sc.ask = undefined; sc.branches = undefined; fails(rs, "safety");
  });
});

/** A scripted drafter: returns the baseline scenarios it was asked for, with a marker word in step 1. */
function drafter(log: LlmRequest[], marker = "LLM") {
  return async (req: LlmRequest) => {
    log.push(req);
    const body = JSON.parse(req.prompt) as { scenarioIds: string[]; baseline: { steps: { text: string }[] }[] };
    return JSON.stringify({ scenarios: body.baseline.map((b) => ({ ...b, steps: b.steps.map((st, i) => (i === 0 ? { ...st, text: `${marker}: ${st.text}` } : st)) })) });
  };
}

describe("generation, fallback and partial regeneration (spec 5.4, 7)", () => {
  it("with no LLM the template rule set is used and labelled 'Standard guide, not personalised yet'", async () => {
    const r = await resolveRules(data, "SS-T", null);
    expect(r.stored.meta.origin).toBe("template");
    expect(r.stored.meta.label).toBe(LABEL_TEMPLATE);
    expect(r.checks.every((x) => x.passed)).toBe(true);
  });

  it("when the LLM fails twice (retry once with the errors) the template set is stored and still works", async () => {
    const log: LlmRequest[] = [];
    __setLlmDrafter(async (req) => { log.push(req); return JSON.stringify({ scenarios: [{ id: "flight-delayed", nope: true }] }); });
    const r = await resolveRules(data, "SS-T", null);
    expect(log.length).toBe(2);
    expect(JSON.parse(log[1].prompt).previousValidationErrors.length).toBeGreaterThan(0);
    expect(r.stored.meta.origin).toBe("template");
    expect(r.stored.meta.label).toBe(LABEL_TEMPLATE);
    expect(validateRuleSet(r.stored.ruleSet, data).ok).toBe(true);
  });

  it("an LLM draft that invents a phone number is rejected, then retried, then replaced by the template", async () => {
    const log: LlmRequest[] = [];
    __setLlmDrafter(async (req) => {
      log.push(req);
      const body = JSON.parse(req.prompt) as { baseline: { steps: { text: string }[] }[] };
      return JSON.stringify({ scenarios: body.baseline.map((b) => ({ ...b, steps: [{ text: "Call the helpline on +44 20 7946 0958." }, ...b.steps] })) });
    });
    const r = await resolveRules(data, "SS-T", null);
    expect(r.stored.meta.origin).toBe("template");
    expect(JSON.stringify(r.stored.ruleSet)).not.toContain("7946");
    expect(r.stored.meta.failures.join(" ")).toMatch(/no_invented_facts/);
  });

  it("a valid LLM draft is stored as 'generated for this trip'", async () => {
    const log: LlmRequest[] = [];
    __setLlmDrafter(drafter(log));
    const r = await resolveRules(data, "SS-T", null);
    expect(log.length).toBe(1);
    expect(r.stored.meta.origin).toBe("llm");
    expect(r.stored.meta.label).toBe(LABEL_LLM);
    expect(JSON.stringify(r.engine["flight-delayed"])).toContain("LLM:");
  });

  it("after a hotel change only the hotel scenario is redrafted; the others keep their stored text", async () => {
    const log: LlmRequest[] = [];
    __setLlmDrafter(drafter(log, "V1"));
    const first = await resolveRules(data, "SS-T", null);
    const changed = clone(data);
    const hid = changed.stays[0].hotelId;
    changed.places[hid] = { ...changed.places[hid], name: "Hotel Nouveau Paris", address_local: "1 Rue Nouvelle, 75001 Paris, France" };
    log.length = 0;
    __setLlmDrafter(drafter(log, "V2"));
    const second = await resolveRules(changed, "SS-T", first.stored);
    expect(second.regenerated).toEqual(["hotel-not-found"]);
    expect(JSON.parse(log[0].prompt).scenarioIds).toEqual(["hotel-not-found"]);
    for (const id of SCENARIO_ORDER) {
      const a = JSON.stringify(first.stored.ruleSet.scenarios.find((x) => x.id === id));
      const b = JSON.stringify(second.stored.ruleSet.scenarios.find((x) => x.id === id));
      if (id === "hotel-not-found") expect(b).toContain("V2:"); else expect(b).toBe(a);
    }
  });

  it("after a flight change the two flight scenarios are redrafted and nothing else", async () => {
    const log: LlmRequest[] = [];
    __setLlmDrafter(drafter(log, "V1"));
    const first = await resolveRules(data, "SS-T", null);
    const changed = clone(data);
    changed.flights[0] = { ...changed.flights[0], flight_no: "SS999" };
    expect(Object.entries(scenarioDeps(changed)).filter(([k, v]) => v !== scenarioDeps(data)[k as keyof ReturnType<typeof scenarioDeps>]).map(([k]) => k).sort()).toEqual(["flight-delayed", "missed-connection"]);
    __setLlmDrafter(drafter(log, "V2"));
    const second = await resolveRules(changed, "SS-T", first.stored);
    expect(second.regenerated.sort()).toEqual(["flight-delayed", "missed-connection"]);
  });

  it("when nothing a scenario is built on changed, the frozen rule set is reused byte for byte", async () => {
    const first = await resolveRules(data, "SS-T", null);
    const again = await resolveRules(clone(data), "SS-T", first.stored);
    expect(again.regenerated).toEqual([]);
    expect(JSON.stringify(again.stored)).toBe(JSON.stringify(first.stored));
  });

  it("publishing a pack stores the rule set and one validation row per check", async () => {
    const [rs] = await c.db.select().from(s.ruleSets).where(eq(s.ruleSets.bookingId, c.booking.id));
    expect(rs.status).toBe("active");
    const rows = await c.db.select().from(s.ruleValidations).where(eq(s.ruleValidations.ruleSetId, rs.id));
    expect(rows.length).toBe(7);
    expect(rows.every((x) => x.passed)).toBe(true);
  });

  it("every shipped template validates against real trip data", async () => {
    const content = await buildPackContent(c.booking.id);
    expect(content.stays.length).toBe(2);
    for (const id of SCENARIO_ORDER) expect(templateScenario(id).id).toBe(id);
  });
});
