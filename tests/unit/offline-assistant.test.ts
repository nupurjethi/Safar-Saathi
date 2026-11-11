import { beforeAll, describe, expect, it } from "vitest";
import { setupDb } from "./helpers";
import { getLatestPack } from "@/lib/packs/build";
import type { OfflinePack } from "@/lib/packs/types";
import { SCENARIO_ORDER } from "@/lib/rules/scenarios";
import { MISSING } from "@/lib/rules/engine";
import { answerOffline, QUICK_QUESTIONS, walkScenario, type OaAnswer } from "@/lib/offline/assistant";
import { scoreIntents } from "@/lib/offline/assistant/intents";
import { lev, tokMatch } from "@/lib/offline/assistant/text";

let pack: OfflinePack;
let day1Noon: Date;
const text = (a: OaAnswer) => [a.title, ...a.lines, ...a.steps.map((s) => s.text)].join("\n");
const ask = (q: string, at = day1Noon, city?: string) => answerOffline(pack, q, { now: at, city });

beforeAll(async () => {
  const { booking } = await setupDb();
  pack = (await getLatestPack(booking.id))!.pack as OfflinePack;
  day1Noon = new Date(`${pack.stays[0].from}T12:00:00Z`);
});

describe("text matching", () => {
  it("is typo tolerant for long words and exact for short ones", () => {
    expect(lev("pasport", "passport")).toBe(1);
    expect(tokMatch("pasport", "passport")).toBe(true);
    expect(tokMatch("hotle", "hotel")).toBe(true); // swap
    expect(tokMatch("cost", "lost")).toBe(false); // short words must match exactly
    expect(tokMatch("delayed", "delay*")).toBe(true);
  });
});

describe("everyday questions are answered from the pack and cite it", () => {
  it("where is my hotel: name, address, local-script address, phone, dates", () => {
    const stay = pack.stays[0];
    const h = pack.places[stay.hotelId];
    const a = ask("Where is my hotel?");
    expect(a.intent).toBe("hotel");
    expect(text(a)).toContain(h.name);
    expect(text(a)).toContain(h.address);
    expect(text(a)).toContain(h.address_local);
    expect(text(a)).toContain(h.phone!);
    expect(text(a)).toContain("Check-in");
    expect(a.links.some((l) => l.kind === "call")).toBe(true);
    expect(a.cites.length).toBeGreaterThan(0);
    expect(a.low).toBe(false);
  });

  it("the city in the question picks the stay (hotel in Rome)", () => {
    const rome = pack.stays.find((s) => s.city === "rome")!;
    const a = ask("What is the address of my hotel in Rome?");
    expect(text(a)).toContain(pack.places[rome.hotelId].name);
  });

  it("flights: every flight, booking code, the next one flagged, no invented terminal", () => {
    const a = ask("what are my flight details");
    expect(a.intent).toBe("flights");
    for (const f of pack.flights) { expect(text(a)).toContain(f.flight_no); expect(text(a)).toContain(f.pnr); }
    expect(text(a)).toMatch(/Terminal and gate are not saved/);
    expect(text(a)).toContain(pack.contacts.airline_phone);
  });

  it("a flight number narrows the answer to that flight", () => {
    const f = pack.flights[1];
    const a = ask(`when does ${f.flight_no.toLowerCase()} leave?`);
    expect(a.intent).toBe("flights");
    expect(a.lines.filter((l) => l.includes(f.flight_no)).length).toBe(1);
    expect(text(a)).not.toContain(pack.flights[0].flight_no);
  });

  it("airport pickup: driver, vendor, code, phone, and the drop-off driver", () => {
    const s = pack.stays[0];
    const a = ask("When is my airport pickup?");
    expect(a.intent).toBe("pickup");
    expect(text(a)).toContain(s.driver.name);
    expect(text(a)).toContain(s.driver.pickup_code);
    expect(text(a)).toContain(s.dropDriver.pickup_code);
    expect(a.links.some((l) => l.kind === "call")).toBe(true);
  });

  it("today / tomorrow / day N plans come from the day items", () => {
    const d1 = pack.days[0], d2 = pack.days[1];
    const a1 = ask("what is the plan for day 1");
    expect(a1.intent).toBe("today");
    expect(text(a1)).toContain(d1.items[0].title);
    const a2 = ask("what are we doing tomorrow?");
    expect(text(a2)).toContain(d2.items[0].title);
    expect(a2.cites[0]).toContain(`Day ${d2.dayNo}`);
    const hi = ask("aaj ka plan kya hai", new Date(`${d1.date}T05:00:00Z`));
    expect(hi.intent).toBe("today");
    expect(text(hi)).toContain(d1.items[0].title);
  });

  it("before the trip it says when it starts; after the trip it says it ended", () => {
    const before = ask("what's my plan today", new Date(new Date(`${pack.booking.dates[0]}T00:00:00Z`).valueOf() - 5 * 864e5));
    expect(text(before)).toMatch(/Your trip starts on/);
    const after = ask("what's my plan today", new Date(new Date(`${pack.booking.dates[1]}T00:00:00Z`).valueOf() + 5 * 864e5));
    expect(text(after)).toMatch(/Your trip ended/);
  });

  it("booking summary has ref, travellers and the total", () => {
    const a = ask("what is my booking reference and who is travelling?");
    expect(a.intent).toBe("booking");
    expect(text(a)).toContain(pack.booking.ref);
    for (const t of pack.booking.travellers) expect(text(a)).toContain(t);
  });

  it("emergency numbers and the consulate", () => {
    const s = pack.stays[0];
    const e = ask("what is the police number here?");
    expect(e.intent).toBe("emergency");
    expect(text(e)).toContain(s.emergency.police);
    expect(text(e)).toContain(s.emergency.ambulance);
    expect(e.links.filter((l) => l.kind === "call").length).toBe(3);
    const c = ask("where is the Indian embassy");
    expect(c.intent).toBe("embassy");
    expect(text(c)).toContain(s.consulate.name);
    const i = ask("what is my insurance helpline");
    expect(i.intent).toBe("insurance");
    expect(text(i)).toContain(pack.contacts.insurance_phone);
  });

  it("currency, tipping, plug, SIM, safety, language are built-in basics, labelled as general guidance", () => {
    for (const [q, intent, needle] of [
      ["what currency do they use", "currency", "Euro"], ["do I need to tip", "tipping", "Service"], ["which plug adapter do I need", "plug", "230 V"],
      ["how do I get a sim card", "sim", "SIM"], ["is the tap water safe", "safety", "Tap water"], ["how do I say thank you", "language", "Merci"],
    ] as const) {
      const a = ask(q);
      expect(a.intent, q).toBe(intent);
      expect(a.generic).toBe(true);
      expect(text(a), q).toContain(needle);
      expect(a.cites[0]).toMatch(/general guidance/);
    }
    // in Rome the basics are Italian
    expect(text(ask("what is the currency in rome"))).toContain("Euro");
    expect(text(ask("how do i say hello", day1Noon, "rome"))).toContain("Buongiorno");
  });

  it("does not invent live data: exchange rates and weather say they are not available offline", () => {
    expect(text(ask("convert 100 euro to rupees"))).toMatch(/cannot convert|not available offline/);
    expect(text(ask("what is the weather"))).toMatch(/not saved offline/);
  });

  it("routes: a named place gets its day, time and saved route; the map link works offline", () => {
    const withRoute = pack.routes.find((r) => pack.places[r.to]?.kind === "poi")!;
    const place = pack.places[withRoute.to];
    const a = ask(`how do I get to ${place.name}?`, day1Noon, place.city);
    expect(a.intent).toBe("routes");
    expect(text(a)).toContain(place.name);
    expect(a.links.some((l) => l.href.includes(`route=${encodeURIComponent(withRoute.id)}`))).toBe(true);
    const generic = ask("show me the route on the map");
    expect(generic.links.some((l) => l.kind === "map")).toBe(true);
  });

  it("a place name alone (no intent word) still says where it is on the plan", () => {
    const poi = Object.values(pack.places).find((p) => p.kind === "poi" && pack.days.some((d) => d.items.some((i) => i.placeId === p.id)))!;
    const a = ask(poi.name);
    expect(a.low).toBe(false);
    expect(text(a)).toContain(poi.name);
    expect(text(a)).toMatch(/Day \d/);
  });

  it("SOS how-to is honest about SMS needing cellular signal", () => {
    const a = ask("how do I send an SOS");
    expect(a.intent).toBe("sos");
    expect(text(a)).toContain("SMS needs cellular signal");
    expect(a.links.some((l) => l.href.endsWith("/sos"))).toBe(true);
  });

  it("what works offline reports the saved bundle version and the guide label", () => {
    const a = ask("what works without internet");
    expect(a.intent).toBe("offline");
    expect(text(a)).toContain(`version ${pack.packVersion}`);
    expect(text(a)).toContain(pack.rulesMeta.label);
  });

  it("'what can you do' explains the assistant and says it is not an AI", () => {
    const a = ask("what can you do?");
    expect(a.intent).toBe("help");
    expect(text(a)).toMatch(/not an AI model/);
    expect(a.suggestions.length).toBeGreaterThan(2);
    expect(ask("hi").intent).toBe("help");
  });
});

describe("the six frozen scenarios (same rule sets, same resolution, no invented values)", () => {
  const cases: [string, (typeof SCENARIO_ORDER)[number]][] = [
    ["My passport is lost", "lost-passport"], ["someone stole my passport", "lost-passport"],
    ["my flight is delayed", "flight-delayed"], ["the airline cancelled my flight", "flight-delayed"],
    ["I missed my connecting flight", "missed-connection"], ["I missed my flight", "missed-connection"],
    ["my hotel has no booking for me", "hotel-not-found"], ["hotel is overbooked", "hotel-not-found"], ["I cant find my hotel", "hotel-not-found"],
    ["my driver has not come", "transfer-no-show"], ["the pickup did not arrive", "transfer-no-show"], ["cab is not here", "transfer-no-show"],
    ["I need a doctor", "medical-help"], ["call an ambulance, my father has chest pain", "medical-help"], ["I feel sick and have fever", "medical-help"],
  ];
  it.each(cases)("%s → %s", (q, id) => {
    const a = ask(q);
    expect(a.intent).toBe(id);
    expect(a.scenarioId).toBe(id);
    expect(a.steps.length).toBeGreaterThanOrEqual(3);
    expect(a.cites[0]).toContain(pack.rules[id].title);
    expect(a.cites[0]).toContain(pack.rulesMeta.label);
    expect(JSON.stringify(a.steps)).not.toContain("{{");
    expect(JSON.stringify(a.steps)).not.toContain(MISSING);
    expect(a.missing).toEqual([]);
    expect(a.links.some((l) => l.href.endsWith("/sos"))).toBe(true);
  });

  it("lost passport gives the police number and the consulate from this stay, and is urgent", () => {
    const s = pack.stays[0];
    const a = ask("passport lost");
    expect(text(a)).toContain(s.emergency.police);
    expect(text(a)).toContain(s.consulate.name);
    expect(a.urgent).toBe(true);
  });

  it("a scenario with a question can be walked: tapping an option adds the branch steps", () => {
    const a = ask("my flight is delayed");
    expect(a.ask?.options.length).toBeGreaterThan(1);
    const next = walkScenario(pack, "flight-delayed", [a.ask!.options[a.ask!.options.length - 1].branch], { now: day1Noon, city: a.city })!;
    expect(next.steps.length).toBeGreaterThan(a.steps.length);
  });

  it("uses the stay the traveller named (passport help in Rome shows the Rome consulate)", () => {
    const rome = pack.stays.find((s) => s.city === "rome")!;
    const a = ask("lost my passport in rome");
    expect(text(a)).toContain(rome.consulate.name);
  });

  it("every scenario in every city resolves with the same data the Guide uses", () => {
    for (const stay of pack.stays) for (const id of SCENARIO_ORDER) {
      const a = walkScenario(pack, id, [], { now: new Date(`${stay.from}T12:00:00Z`), city: stay.city })!;
      expect(a.missing, `${id} ${stay.city}`).toEqual([]);
    }
  });
});

describe("extra problem guides use the booking's real numbers", () => {
  it.each([
    ["my luggage did not arrive", "lost-luggage"], ["my phone was stolen", "phone-lost"], ["I lost my wallet", "money-lost"],
    ["I think the taxi driver scammed me", "scam"], ["I was pickpocketed", "scam"],
  ] as const)("%s → %s", (q, id) => {
    const a = ask(q);
    expect(a.intent).toBe(id);
    expect(a.generic).toBe(true);
    expect(a.steps.length).toBeGreaterThanOrEqual(5);
    expect(a.lines[0]).toMatch(/Standard guidance/);
    expect(JSON.stringify(a.steps)).not.toContain(MISSING);
    expect(a.links.some((l) => l.href.endsWith("/sos"))).toBe(true);
  });
  it("lost luggage names the airline and the hotel address; wallet guide includes the police number", () => {
    expect(text(ask("my bag is missing"))).toContain(pack.contacts.airline);
    expect(text(ask("I lost my wallet"))).toContain(pack.stays[0].emergency.police);
  });
});

describe("Hinglish and typos", () => {
  it.each([
    ["passport kho gaya", "lost-passport"], ["mera passport chori ho gaya", "lost-passport"], ["pasport lost", "lost-passport"],
    ["hotel kahan hai", "hotel"], ["driver nahi aaya", "transfer-no-show"], ["flight delay ho gayi", "flight-delayed"],
    ["mera paisa kho gaya", "money-lost"], ["phone chori ho gaya", "phone-lost"], ["tabiyat kharab hai", "medical-help"],
    ["flight chhut gayi", "missed-connection"], ["hotel nahi mila", "hotel-not-found"], ["madad chahiye", "sos"], ["kya kar sakte ho", "help"],
    ["wher is my hotle", "hotel"], ["poilce number", "emergency"],
  ] as const)("%s → %s", (q, id) => {
    expect(ask(q).intent).toBe(id);
  });
});

describe("limits and honesty", () => {
  it("never changes anything: change requests say they need a connection and a Confirm tap", () => {
    for (const q of ["move my flight to tomorrow", "please extend my stay in Rome by 1 night", "cancel my hotel booking", "can I get a refund"]) {
      const a = ask(q);
      expect(a.intent, q).toBe("change");
      expect(a.needsOnline).toBe(true);
      expect(text(a)).toMatch(/Confirm/);
      expect(text(a)).toMatch(/cannot book, change, extend or cancel/);
    }
  });

  it("'cancelled flight' is a disruption, 'cancel my flight' is a change", () => {
    expect(ask("my flight got cancelled").intent).toBe("flight-delayed");
    expect(ask("cancel my flight").intent).toBe("change");
  });

  it("low confidence: says it cannot answer offline and suggests real questions", () => {
    for (const q of ["what is the capital of france", "tell me a joke", "asdf qwer", "how tall is mount everest"]) {
      const a = ask(q);
      expect(a.low, q).toBe(true);
      expect(a.title).toBe("I can't answer that offline");
      expect(a.suggestions.length).toBeGreaterThanOrEqual(3);
      expect(a.steps).toEqual([]);
    }
  });

  it("empty input shows the help", () => {
    expect(ask("   ").intent).toBe("help");
  });

  it("every quick question gets a confident answer", () => {
    for (const q of QUICK_QUESTIONS) { const a = ask(q); expect(a.low, q).toBe(false); expect(a.confidence, q).toBeGreaterThan(0.5); }
  });

  it("no scenario word 'wins' over a clearly different question", () => {
    expect(ask("when is my pickup").intent).toBe("pickup");
    expect(ask("where is my hotel").intent).toBe("hotel");
    expect(ask("what time is check in").intent).toBe("hotel");
    expect(scoreIntents("where is my hotel")[0].id).toBe("hotel");
  });

  it("is instant (a typical answer in well under 50 ms)", () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) ask("my passport is lost");
    expect((performance.now() - t0) / 20).toBeLessThan(50);
  });
});
