import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupDb, items } from "./helpers";
import * as s from "@/lib/db/schema";
import { applyChange, createQuote, declineQuote, issueConfirmation, type ReviewCard } from "@/lib/gate/changes";
import { GateError } from "@/lib/gate/errors";
import { searchFlights } from "@/app/api/mock/v1/flights/search/route";
import { getLatestPack } from "@/lib/packs/build";
import { assertBreakup } from "@/lib/providers/types";

type Ctx = Awaited<ReturnType<typeof setupDb>>;
let ctx: Ctx;
let interItemId: string;

async function flightQuote(chaos?: string | null): Promise<ReviewCard> {
  const its = await items(ctx.booking.id);
  const inter = its.find((i) => i.kind === "flight" && i.status === "confirmed" && i.details.leg === "intercity")!;
  interItemId = inter.id;
  const d = inter.details as Record<string, string>;
  const alts = await searchFlights({ from: d.from, to: d.to, date: inter.date, pax: ctx.booking.pax, anchor: "depart" });
  const alt = alts.find((f) => f.id !== d.flightId && f.available)!;
  expect(alt).toBeTruthy();
  return createQuote({ bookingRef: ctx.booking.ref, userId: ctx.neha.id, kind: "flight_change", params: { itemId: inter.id, newFlightId: alt.id }, chaos });
}

async function bookingTotal() {
  const [b] = await ctx.db.select().from(s.bookings).where(eq(s.bookings.id, ctx.booking.id));
  return b;
}
async function expectGate(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}

beforeAll(async () => {
  ctx = await setupDb();
});

describe("confirmation gate", () => {
  it("every quote carries a price breakup whose lines add up to the total, with a source and validity time", async () => {
    const card = await flightQuote();
    expect(card.breakup.length).toBeGreaterThanOrEqual(2);
    expect(card.breakup.reduce((a, l) => a + l.amountInr, 0)).toBe(card.totalInr);
    expect(card.totalInr).toBe(card.priceDeltaInr);
    expect(card.source).toBe("Sample data (mock API)");
    expect(new Date(card.validUntil).getTime()).toBeGreaterThan(Date.now());
    const rows = await ctx.db.select().from(s.priceBreakups).where(eq(s.priceBreakups.quoteId, card.quoteId));
    expect(rows.length).toBe(card.breakup.length);
    await declineQuote({ quoteId: card.quoteId, userId: ctx.neha.id });
  });

  it("a quote whose lines do not sum to the total is rejected", () => {
    expect(() => assertBreakup([{ label: "Base", amountInr: 100 }, { label: "Fee", amountInr: 50 }], 140)).toThrow(/BREAKUP_MISMATCH/);
    expect(() => assertBreakup([{ label: "Base", amountInr: 100 }, { label: "Fee", amountInr: 50 }], 150)).not.toThrow();
  });

  it("tampering with the stored breakup is caught by the quote hash", async () => {
    const card = await flightQuote();
    await ctx.db.update(s.changeQuotes).set({ breakup: [{ label: "Everything", amountInr: card.totalInr }] }).where(eq(s.changeQuotes.id, card.quoteId));
    await expectGate(issueConfirmation({ quoteId: card.quoteId, userId: ctx.neha.id }), "QUOTE_TAMPERED");
  });

  it("apply without a token fails and changes nothing", async () => {
    const card = await flightQuote();
    const before = await bookingTotal();
    await expectGate(applyChange({ quoteId: card.quoteId, token: undefined, userId: ctx.neha.id }), "NO_TOKEN");
    await expectGate(applyChange({ quoteId: card.quoteId, token: "", userId: ctx.neha.id }), "NO_TOKEN");
    await expectGate(applyChange({ quoteId: card.quoteId, token: "made-up-token", userId: ctx.neha.id }), "TOKEN_INVALID");
    const after = await bookingTotal();
    expect(after.totalInr).toBe(before.totalInr);
    expect(after.packVersion).toBe(before.packVersion);
  });

  it("decline leaves the booking untouched and cancels the quote", async () => {
    const card = await flightQuote();
    const before = await items(ctx.booking.id);
    await declineQuote({ quoteId: card.quoteId, userId: ctx.neha.id });
    const [q] = await ctx.db.select().from(s.changeQuotes).where(eq(s.changeQuotes.id, card.quoteId));
    expect(q.status).toBe("declined");
    await expectGate(issueConfirmation({ quoteId: card.quoteId, userId: ctx.neha.id }), "QUOTE_NOT_OPEN");
    expect((await items(ctx.booking.id)).length).toBe(before.length);
  });

  it("a valid single-use token applies the change, rebuilds the pack (+1) and cannot be reused", async () => {
    const card = await flightQuote();
    const v0 = (await bookingTotal()).packVersion;
    const { token } = await issueConfirmation({ quoteId: card.quoteId, userId: ctx.neha.id });
    const receipt = await applyChange({ quoteId: card.quoteId, token, userId: ctx.neha.id });
    expect(receipt.packVersion).toBe(v0 + 1);
    expect(receipt.guide.updated).toBe(true);
    expect(receipt.guide.message).toMatch(/updated to version/);
    expect(receipt.priceDeltaInr).toBe(card.priceDeltaInr);
    const its = await items(ctx.booking.id);
    expect(its.find((i) => i.id === interItemId)!.status).toBe("replaced");
    // reuse
    await expectGate(applyChange({ quoteId: card.quoteId, token, userId: ctx.neha.id }), "TOKEN_USED");
    // only the hash is stored
    const confs = await ctx.db.select().from(s.confirmations);
    expect(confs.every((c) => c.tokenHash !== token && c.tokenHash.length === 64)).toBe(true);
    expect((await getLatestPack(ctx.booking.id))!.version).toBe(v0 + 1);
  });

  it("an expired token is rejected", async () => {
    const card = await flightQuote();
    const { token } = await issueConfirmation({ quoteId: card.quoteId, userId: ctx.neha.id });
    await ctx.db.update(s.confirmations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.confirmations.quoteId, card.quoteId));
    await expectGate(applyChange({ quoteId: card.quoteId, token, userId: ctx.neha.id }), "TOKEN_EXPIRED");
  });

  it("a token for another quote / another booking is rejected", async () => {
    const a = await flightQuote();
    const b = await flightQuote();
    const { token } = await issueConfirmation({ quoteId: a.quoteId, userId: ctx.neha.id });
    await expectGate(applyChange({ quoteId: b.quoteId, token, userId: ctx.neha.id }), "TOKEN_MISMATCH");
    // a different user cannot use Neha's token even with the right quote
    const [other] = await ctx.db.insert(s.users).values({ email: "other@test.local", name: "Other" }).returning();
    await expectGate(applyChange({ quoteId: a.quoteId, token, userId: other.id }), "TOKEN_MISMATCH");
    await expectGate(createQuote({ bookingRef: ctx.booking.ref, userId: other.id, kind: "flight_change", params: {} }), "FORBIDDEN");
    await expectGate(issueConfirmation({ quoteId: a.quoteId, userId: other.id }), "FORBIDDEN");
  });

  it("params with undefined fields (as the agent tool sends them) still hash-match after the JSONB round trip", async () => {
    const its = await items(ctx.booking.id);
    const inter = its.find((i) => i.kind === "flight" && i.status === "confirmed" && i.details.leg === "intercity")!;
    const d = inter.details as Record<string, string>;
    const alts = await searchFlights({ from: d.from, to: d.to, date: inter.date, pax: ctx.booking.pax, anchor: "depart" });
    const alt = alts.find((f) => f.id !== d.flightId && f.available)!;
    const card = await createQuote({ bookingRef: ctx.booking.ref, userId: ctx.neha.id, kind: "flight_change", params: { itemId: inter.id, newFlightId: alt.id, extraNights: undefined } });
    const { token } = await issueConfirmation({ quoteId: card.quoteId, userId: ctx.neha.id });
    expect(token.length).toBeGreaterThan(20);
    await declineQuote({ quoteId: card.quoteId, userId: ctx.neha.id });
  });

  it("a tampered quote is caught by the quote hash", async () => {
    const card = await flightQuote();
    await ctx.db.update(s.changeQuotes).set({ priceDeltaInr: 1 }).where(eq(s.changeQuotes.id, card.quoteId));
    await expectGate(issueConfirmation({ quoteId: card.quoteId, userId: ctx.neha.id }), "QUOTE_TAMPERED");
  });

  it("an expired quote cannot be confirmed", async () => {
    const card = await flightQuote();
    await ctx.db.update(s.changeQuotes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.changeQuotes.id, card.quoteId));
    await expectGate(issueConfirmation({ quoteId: card.quoteId, userId: ctx.neha.id }), "QUOTE_EXPIRED");
  });

  it("price move: 409 PRICE_CHANGED with a new quote, old token void, then re-confirm succeeds", async () => {
    const card = await flightQuote("price_move");
    const v0 = (await bookingTotal()).packVersion;
    const { token } = await issueConfirmation({ quoteId: card.quoteId, userId: ctx.neha.id });
    const err = await applyChange({ quoteId: card.quoteId, token, userId: ctx.neha.id }).catch((e) => e);
    expect(err).toBeInstanceOf(GateError);
    expect(err.code).toBe("PRICE_CHANGED");
    expect(err.status).toBe(409);
    const nq = err.extra.newQuote as ReviewCard;
    expect(nq.priceDeltaInr).toBeGreaterThan(card.priceDeltaInr);
    expect((await bookingTotal()).packVersion).toBe(v0); // nothing applied
    await expectGate(applyChange({ quoteId: card.quoteId, token, userId: ctx.neha.id }), "TOKEN_USED");
    const t2 = await issueConfirmation({ quoteId: nq.quoteId, userId: ctx.neha.id });
    const receipt = await applyChange({ quoteId: nq.quoteId, token: t2.token, userId: ctx.neha.id });
    expect(receipt.priceDeltaInr).toBe(nq.priceDeltaInr);
    expect(receipt.packVersion).toBe(v0 + 1);
  });

  it("hotel extension moves the stay, return flight and drop-off, and bumps the pack", async () => {
    const v0 = (await bookingTotal()).packVersion;
    const card = await createQuote({ bookingRef: ctx.booking.ref, userId: ctx.neha.id, kind: "hotel_extend", params: { extraNights: 1 } });
    expect(card.after.lines.some((l) => l.label.startsWith("Return flight"))).toBe(true);
    const { token } = await issueConfirmation({ quoteId: card.quoteId, userId: ctx.neha.id });
    const receipt = await applyChange({ quoteId: card.quoteId, token, userId: ctx.neha.id });
    expect(receipt.packVersion).toBe(v0 + 1);
    const b = await bookingTotal();
    expect(b.endDate > ctx.booking.endDate).toBe(true);
    const pack = (await getLatestPack(ctx.booking.id))!.pack as { days: unknown[]; booking: { dates: string[] } };
    expect(pack.booking.dates[1]).toBe(b.endDate);
  });

  it("over the price limit: no token can be minted", async () => {
    const prev = process.env.PRICE_LIMIT_INR;
    process.env.PRICE_LIMIT_INR = "10";
    try {
      const card = await flightQuote();
      expect(card.blocked).toBe(true);
      await expectGate(issueConfirmation({ quoteId: card.quoteId, userId: ctx.neha.id }), "OVER_LIMIT");
    } finally {
      process.env.PRICE_LIMIT_INR = prev;
    }
  });

  it("logs blocked applies in the action log", async () => {
    const blocked = await ctx.db.select().from(s.toolCalls).where(and(eq(s.toolCalls.tool, "apply_change"), eq(s.toolCalls.status, "blocked")));
    expect(blocked.length).toBeGreaterThan(0);
  });
});
