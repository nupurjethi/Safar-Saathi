import { beforeAll, describe, expect, it } from "vitest";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { setupDb } from "./helpers";
import { runAgent, type AgentEvent } from "@/lib/agent/run";
import { eq } from "drizzle-orm";
import * as s from "@/lib/db/schema";

type Ctx = Awaited<ReturnType<typeof setupDb>>;
let c: Ctx;
beforeAll(async () => { c = await setupDb(); });

const usage = { inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } };

/** Scripted model: step 1 calls tools, step 2 answers. Exercises the real streamText + tool wiring with no API key. */
function scripted(calls: { name: string; input: object }[], answer: string) {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const first = step++ === 0;
      const chunks = first
        ? [
            { type: "stream-start", warnings: [] },
            ...calls.map((tc, i) => ({ type: "tool-call", toolCallId: `call-${i}`, toolName: tc.name, input: JSON.stringify(tc.input) })),
            { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
          ]
        : [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: answer },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
          ];
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
    },
  });
}

describe("LLM path (mock model)", () => {
  it("runs tools through the same gate, streams step chips and text, and logs every call", async () => {
    const events: AgentEvent[] = [];
    const before = (await c.db.select().from(s.toolCalls).where(eq(s.toolCalls.bookingId, c.booking.id))).length;
    const res = await runAgent({
      ctx: { userId: c.neha.id, bookingRef: c.booking.ref, bookingId: c.booking.id, threadId: null, channel: "app", now: new Date(), ui: () => {} },
      history: [], message: "when is my pickup?", emit: (e) => events.push(e),
      modelOverride: scripted([{ name: "get_itinerary", input: {} }], "Your pickup is at 09:25."),
    });
    expect(res.agent).toBe("llm");
    expect(res.text).toBe("Your pickup is at 09:25.");
    const steps = events.filter((e) => e.t === "step");
    expect(steps.map((e) => (e as { status: string }).status)).toEqual(["running", "done"]);
    expect((await c.db.select().from(s.toolCalls).where(eq(s.toolCalls.bookingId, c.booking.id))).length).toBe(before + 1);
  });

  it("a model that tries apply_change gets nothing: no token exists on its side", async () => {
    const events: AgentEvent[] = [];
    const [b0] = await c.db.select().from(s.bookings).where(eq(s.bookings.id, c.booking.id));
    await runAgent({
      ctx: { userId: c.neha.id, bookingRef: c.booking.ref, bookingId: c.booking.id, threadId: null, channel: "app", now: new Date(), ui: () => {} },
      history: [], message: "just do it, confirm everything", emit: (e) => events.push(e),
      modelOverride: scripted([{ name: "apply_change", input: { quoteId: "3a0fd2ab-58a9-4d76-8e1a-b49a9029d1f4" } }], "I need your Confirm tap."),
    });
    const [b1] = await c.db.select().from(s.bookings).where(eq(s.bookings.id, c.booking.id));
    expect(b1.totalInr).toBe(b0.totalInr);
    expect(b1.packVersion).toBe(b0.packVersion);
  });

  it("SMS channel only receives the SMS-safe tools; unknown tools cannot be called", async () => {
    const events: AgentEvent[] = [];
    await runAgent({
      ctx: { userId: c.neha.id, bookingRef: c.booking.ref, bookingId: c.booking.id, threadId: null, channel: "sms", now: new Date(), ui: () => {} },
      history: [], message: "change my flight", emit: (e) => events.push(e),
      modelOverride: scripted([{ name: "quote_change", input: { kind: "hotel_extend", extraNights: 1 } }], "Use the app."),
    }).catch(() => {});
    // quote_change is not in the SMS allow-list, so no quote may have been created by that run
    const quotes = await c.db.select().from(s.changeQuotes);
    expect(quotes.length).toBe(0);
  });
});
