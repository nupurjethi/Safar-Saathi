import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { applyChange, createQuote, issueConfirmation } from "@/lib/gate/changes";
import { GateError } from "@/lib/gate/errors";
import { getLatestPack } from "@/lib/packs/build";
import type { OfflinePack } from "@/lib/packs/types";
import { PLATFORMS, platformLinks, isInternational } from "@/lib/providers/platforms";
import { connectedPlatforms, setConnected } from "@/lib/server/connections";
import { setupDb } from "./helpers";
import { localDate, localTime } from "@/lib/time";

let c: Awaited<ReturnType<typeof setupDb>>;
beforeAll(async () => { c = await setupDb(); });

async function flightItem(leg: string) {
  const db = await getDb();
  const rows = await db.select().from(s.bookingItems).where(and(eq(s.bookingItems.bookingId, c.booking.id), eq(s.bookingItems.kind, "flight"), eq(s.bookingItems.status, "confirmed")));
  return rows.find((r) => r.details.leg === leg)!;
}
const iso = (d: Date, tz: string) => `${localDate(d, tz)}T${localTime(d, tz)}`;
const goodParams = async () => {
  const it = await flightItem("return");
  const d = it.details as Record<string, string>;
  const dep = new Date(new Date(d.departAt).getTime() + 5 * 3600e3), arr = new Date(new Date(d.arriveAt).getTime() + 5 * 3600e3);
  // the return flight leaves Rome and lands in the origin: use the pack's time zones
  const pack = (await getLatestPack(c.booking.id))!.pack as OfflinePack;
  const pf = pack.flights.find((f) => f.leg === "return")!;
  return { platform: "makemytrip", itemId: it.id, flightNo: "ai 143", carrierName: "Air India", departLocal: iso(dep, pf.from_tz), arriveLocal: iso(arr, pf.to_tz), pnr: "ab12cd", fareDiffInr: 4200, changeFeeInr: 3000 };
};

describe("booking platforms: links only, never credentials", () => {
  it("builds each platform's own search link for the same route and day", () => {
    const links = platformLinks({ from: "FCO", to: "PNQ", date: "2026-11-20", pax: 4 });
    expect(links.map((l) => l.id)).toEqual(["makemytrip", "goibibo", "cleartrip", "ixigo"]);
    for (const l of links) {
      expect(l.searchUrl).toMatch(/^https:\/\/www\./);
      expect(l.searchUrl).toContain("FCO");
      expect(l.searchUrl).toContain("PNQ");
      expect(l.manageUrl).toMatch(/^https:\/\//);
    }
    expect(PLATFORMS.makemytrip.searchUrl({ from: "DEL", to: "BLR", date: "2026-11-20", pax: 2, international: false })).toContain("20/11/2026");
    expect(isInternational("DEL", "BLR")).toBe(false);
    expect(isInternational("FCO", "PNQ")).toBe(true);
  });
  it("remembers which platform you say you are logged in to (self-declared)", async () => {
    expect(await connectedPlatforms(c.neha.id)).toEqual([]);
    expect(await setConnected(c.neha.id, "ixigo", true)).toEqual(["ixigo"]);
    expect(await setConnected(c.neha.id, "goibibo", true)).toEqual(["goibibo", "ixigo"]);
    expect(await setConnected(c.neha.id, "ixigo", false)).toEqual(["goibibo"]);
    await expect(setConnected(c.neha.id, "skyscanner", true)).rejects.toThrow();
  });
});

describe("recording a flight changed on a platform goes through the confirmation gate", () => {
  it("creates a review card from what the traveller entered, changing nothing yet", async () => {
    const before = await flightItem("return");
    const card = await createQuote({ bookingRef: c.booking.ref, userId: c.neha.id, kind: "flight_external", params: await goodParams() });
    expect(card.kind).toBe("flight_external");
    expect(card.title).toBe("Record your flight change");
    expect(card.source).toMatch(/Entered by you from MakeMyTrip.*Not verified/);
    expect(card.notice).toMatch(/books and charges nothing/);
    expect(card.breakup.map((l) => l.amountInr)).toEqual([4200, 3000]);
    expect(card.totalInr).toBe(7200);
    expect(card.after.lines.find((l) => l.label === "Flight")!.value).toBe("Air India AI143");
    expect(card.after.lines.find((l) => l.label === "Booking code")!.value).toBe("AB12CD");
    expect((await flightItem("return")).id).toBe(before.id); // not changed until Confirm
  });

  it("needs the Confirm token; then updates the flight, the totals and the offline guide", async () => {
    const params = await goodParams();
    const card = await createQuote({ bookingRef: c.booking.ref, userId: c.neha.id, kind: "flight_external", params });
    await expect(applyChange({ quoteId: card.quoteId, token: null, userId: c.neha.id })).rejects.toMatchObject({ code: "NO_TOKEN" });
    const [b0] = await (await getDb()).select().from(s.bookings).where(eq(s.bookings.id, c.booking.id));
    const { token } = await issueConfirmation({ quoteId: card.quoteId, userId: c.neha.id });
    const receipt = await applyChange({ quoteId: card.quoteId, token, userId: c.neha.id });
    expect(receipt.kind).toBe("flight_external");
    expect(receipt.priceDeltaInr).toBe(7200);
    expect(receipt.newTotalInr).toBe(b0.totalInr + 7200);
    expect(receipt.packVersion).toBeGreaterThan(b0.packVersion);
    const now = await flightItem("return");
    expect(now.details.flightNo).toBe("AI143");
    expect(now.details.pnr).toBe("AB12CD");
    expect(now.details.externalPlatform).toBe("makemytrip");
    const pack = (await getLatestPack(c.booking.id))!.pack as OfflinePack;
    expect(pack.flights.find((f) => f.leg === "return")!.flight_no).toBe("AI143");
    const db = await getDb();
    const pays = await db.select().from(s.payments).where(and(eq(s.payments.bookingId, c.booking.id), eq(s.payments.method, "external")));
    expect(pays.length).toBe(1);
    expect(pays[0].status).toBe("recorded"); // a record of what you paid there, not a charge by us
    await expect(applyChange({ quoteId: card.quoteId, token, userId: c.neha.id })).rejects.toBeInstanceOf(GateError); // single use
  });

  it("is not blocked by the price limit (we are not charging anything), but bad input is rejected", async () => {
    const params = await goodParams();
    const big = await createQuote({ bookingRef: c.booking.ref, userId: c.neha.id, kind: "flight_external", params: { ...params, fareDiffInr: 90000 } });
    expect(big.blocked).toBe(false);
    for (const bad of [
      { platform: "skyscanner" }, { flightNo: "??" }, { pnr: "12" }, { carrierName: "" }, { fareDiffInr: -5 }, { fareDiffInr: 1.5 },
      { departLocal: "tomorrow" }, { arriveLocal: (params.departLocal as string) }, { departLocal: "2020-01-01T10:00", arriveLocal: "2020-01-01T12:00" },
      { departLocal: "2031-01-01T10:00", arriveLocal: "2031-01-01T12:00" }, // more than 7 days from the old flight
    ]) {
      await expect(createQuote({ bookingRef: c.booking.ref, userId: c.neha.id, kind: "flight_external", params: { ...params, ...bad } }), JSON.stringify(bad)).rejects.toBeInstanceOf(GateError);
    }
  });

  it("another user cannot record a change on this booking", async () => {
    await expect(createQuote({ bookingRef: c.booking.ref, userId: "00000000-0000-4000-8000-000000000000", kind: "flight_external", params: await goodParams() })).rejects.toBeInstanceOf(GateError);
  });
});
