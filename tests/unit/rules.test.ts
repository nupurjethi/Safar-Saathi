import { beforeAll, describe, expect, it } from "vitest";
import { setupDb } from "./helpers";
import { getLatestPack, stableStringify } from "@/lib/packs/build";
import { packContentHash } from "@/lib/packs/hash";
import type { OfflinePack } from "@/lib/packs/types";
import { SCENARIO_ORDER } from "@/lib/rules/scenarios";
import { fill, lookup, resolve, templatePaths, walk, MISSING } from "@/lib/rules/engine";
import { buildContext, currentStay } from "@/lib/rules/context";
import { validateRuleSet } from "@/lib/rules/validate";
import { LABEL_TEMPLATE } from "@/lib/rules/generate";

let pack: OfflinePack;
beforeAll(async () => {
  const { booking } = await setupDb();
  pack = (await getLatestPack(booking.id))!.pack as OfflinePack;
});

describe("rule engine (reads the stored rule set only)", () => {
  it("the stored pack has the 6 scenarios, a validated rule set and an honest label", () => {
    expect(Object.keys(pack.rules).sort()).toEqual([...SCENARIO_ORDER].sort());
    expect(validateRuleSet(pack.ruleSet, pack).ok).toBe(true);
    expect(pack.rulesMeta.label).toBe(LABEL_TEMPLATE); // no LLM key in tests: the template rule set, labelled as such
  });

  it.each(SCENARIO_ORDER)("%s: every {{template}} resolves from pack data in every city", (id) => {
    const sc = pack.rules[id];
    for (const stay of pack.stays) {
      const ctx = buildContext(pack, new Date(`${stay.from}T12:00:00Z`), stay.city);
      const missing: string[] = [];
      const out = resolve(sc, ctx, (p) => missing.push(p));
      expect(missing, `${id} in ${stay.city}`).toEqual([]);
      for (const p of templatePaths(sc)) expect(lookup(ctx, p), p).toBeTruthy();
      expect(JSON.stringify(out)).not.toContain("{{");
      expect(JSON.stringify(out)).not.toContain(MISSING);
    }
  });

  it("fills templates (including array indexes) and flags missing values instead of inventing them", () => {
    expect(fill("Call {{a.b}}", { a: { b: "123" } })).toBe("Call 123");
    expect(fill("Call {{a.b[1].c}}", { a: { b: [{ c: "x" }, { c: "y" }] } })).toBe("Call y");
    const miss: string[] = [];
    expect(fill("x {{nope}}", {}, (p) => miss.push(p))).toBe(`x ${MISSING}`);
    expect(miss).toEqual(["nope"]);
  });

  it("walks decision-tree branches", () => {
    const sc = resolve(pack.rules["flight-delayed"], buildContext(pack));
    const base = walk(sc, []);
    expect(base.ask?.options.length).toBe(3);
    expect(walk(sc, ["long"]).steps.length).toBeGreaterThan(base.steps.length);
  });

  it("hotel-not-found shows the local-script hotel address; lost-passport shows the consulate", () => {
    const stay = pack.stays[1];
    const ctx = buildContext(pack, new Date(`${stay.from}T12:00:00Z`));
    expect(JSON.stringify(resolve(pack.rules["hotel-not-found"], ctx))).toContain(pack.places[stay.hotelId].address_local);
    expect(JSON.stringify(resolve(pack.rules["lost-passport"], ctx))).toContain(stay.consulate.name);
  });

  it("picks the current city by date and honours a manual override", () => {
    expect(currentStay(pack, new Date(`${pack.stays[0].from}T12:00:00Z`)).city).toBe("paris");
    expect(currentStay(pack, new Date(`${pack.stays[1].from}T20:00:00Z`)).city).toBe("rome");
    expect(currentStay(pack, new Date(`${pack.stays[0].from}T12:00:00Z`), "rome").city).toBe("rome");
  });

  it("the pack's content hash (rules included) can be re-verified on the phone", async () => {
    expect(await packContentHash(pack as unknown as Record<string, unknown>)).toBe(pack.contentHash);
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(pack.disclaimer).toBe("Predefined guidance from your booking. Not live information.");
    expect(pack.contacts.sample).toBe(true);
  });

  it("the rule interpreter module stays under 5 KB and never imports a network or model module", async () => {
    const fs = await import("node:fs");
    expect(fs.statSync("lib/rules/engine.ts").size).toBeLessThan(5 * 1024);
    const src = fs.readFileSync("lib/rules/engine.ts", "utf8");
    expect(src).not.toMatch(/fetch\(|@\/lib\/llm|from "ai"/);
  });
});
