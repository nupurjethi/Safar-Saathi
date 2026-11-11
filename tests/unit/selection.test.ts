import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupDb } from "./helpers";
import * as s from "@/lib/db/schema";
import { createQuote } from "@/lib/gate/changes";
import { payTrip, selectTrip } from "@/lib/server/trips";
import { addDays } from "@/lib/time";
import { getLatestPack } from "@/lib/packs/build";
import type { OfflinePack } from "@/lib/packs/types";
import { syncLocalCase } from "@/lib/server/cases";

type Ctx = Awaited<ReturnType<typeof setupDb>>;
let c: Ctx;
const start = () => addDays(new Date().toISOString().slice(0, 10), 6);
beforeAll(async () => { c = await setupDb(); });

describe("selecting a trip (spec 1.3 to 1.6)", () => {
  it("creates a draft and builds the offline bundle BEFORE any payment", async () => {
    const r = await selectTrip({ userId: c.neha.id, slug: "paris-rome-classic-7n", startDate: start(), pax: 2 }, c.db);
    const [b] = await c.db.select().from(s.bookings).where(eq(s.bookings.ref, r.ref));
    expect(b.status).toBe("draft");
    const [d] = await c.db.select().from(s.tripDrafts).where(eq(s.tripDrafts.bookingId, b.id));
    expect(d.status).toBe("ready");
    expect(await c.db.select().from(s.payments).where(eq(s.payments.bookingId, b.id))).toHaveLength(0);
    const row = await getLatestPack(b.id, c.db);
    const pack = row!.pack as OfflinePack;
    expect(pack.booking.status).toBe("draft");
    expect(Object.keys(pack.rules)).toHaveLength(6);
    expect(pack.routes.length).toBeGreaterThan(0);
    expect(pack.rulesMeta.label).toBeTruthy();
    expect(r.packVersion).toBe(1);
  });

  it("a draft cannot be changed by the agent until it is booked", async () => {
    const r = await selectTrip({ userId: c.neha.id, slug: "paris-rome-classic-7n", startDate: start(), pax: 2 }, c.db);
    await expect(createQuote({ bookingRef: r.ref, userId: c.neha.id, kind: "hotel_extend", params: { extraNights: 1 } }, c.db)).rejects.toMatchObject({ code: "NOT_BOOKED" });
  });

  it("paying confirms the booking, keeps the same guide (rules reused) and adds traveller names", async () => {
    const r = await selectTrip({ userId: c.neha.id, slug: "paris-rome-classic-7n", startDate: start(), pax: 2 }, c.db);
    const before = (await getLatestPack((await c.db.select().from(s.bookings).where(eq(s.bookings.ref, r.ref)))[0].id, c.db))!.pack as OfflinePack;
    const paid = await payTrip({ userId: c.neha.id, ref: r.ref, travellers: [{ name: "Asha T", ageBand: "adult" }, { name: "Ravi T", ageBand: "adult" }] }, c.db);
    expect(paid.guideUpdated).toBe(true);
    const [b] = await c.db.select().from(s.bookings).where(eq(s.bookings.ref, r.ref));
    expect(b.status).toBe("confirmed");
    expect(await c.db.select().from(s.payments).where(eq(s.payments.bookingId, b.id))).toHaveLength(1);
    const after = (await getLatestPack(b.id, c.db))!.pack as OfflinePack;
    expect(after.packVersion).toBe(before.packVersion + 1);
    expect(after.booking.status).toBe("confirmed");
    expect(after.booking.travellers).toEqual(["Asha T", "Ravi T"]);
    expect(JSON.stringify(after.ruleSet)).toBe(JSON.stringify(before.ruleSet)); // frozen rules reused
    await expect(payTrip({ userId: c.neha.id, ref: r.ref, travellers: [{ name: "A B", ageBand: "adult" }, { name: "C D", ageBand: "adult" }] }, c.db)).rejects.toMatchObject({ code: "QUOTE_NOT_OPEN" });
    const q = await createQuote({ bookingRef: r.ref, userId: c.neha.id, kind: "hotel_extend", params: { extraNights: 1 } }, c.db);
    expect(q.breakup.length).toBe(3);
  });

  it("a user can hold several trips, each with its own ref and bundle", async () => {
    const a = await selectTrip({ userId: c.neha.id, slug: "paris-rome-classic-7n", startDate: start(), pax: 2 }, c.db);
    const b = await selectTrip({ userId: c.neha.id, slug: "paris-rome-classic-7n", startDate: start(), pax: 3 }, c.db);
    expect(a.ref).not.toBe(b.ref);
    const rows = await c.db.select().from(s.offlinePacks);
    expect(new Set(rows.map((r) => r.bookingId)).size).toBeGreaterThanOrEqual(2);
  });

  it("someone else's trip cannot be paid for", async () => {
    const r = await selectTrip({ userId: c.neha.id, slug: "paris-rome-classic-7n", startDate: start(), pax: 1 }, c.db);
    const [other] = await c.db.insert(s.users).values({ email: "o2@test.local", name: "O" }).returning();
    await expect(payTrip({ userId: other.id, ref: r.ref, travellers: [{ name: "Zed Z", ageBand: "adult" }] }, c.db)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("offline SOS upload (spec 8.2, 8.3)", () => {
  it("a case saved on the phone uploads once; sending it again returns the same reference", async () => {
    const queuedAt = new Date().toISOString();
    const a = await syncLocalCase({ localId: "local-abc-123456", queuedAt, bookingId: c.booking.id, scenario: "lost passport" }, c.db);
    const b = await syncLocalCase({ localId: "local-abc-123456", queuedAt, bookingId: c.booking.id, scenario: "lost passport" }, c.db);
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.caseRef).toBe(a.caseRef);
    const rows = await c.db.select().from(s.sosCasesLocalSync).where(eq(s.sosCasesLocalSync.localId, "local-abc-123456"));
    expect(rows).toHaveLength(1);
    const [cs] = await c.db.select().from(s.cases).where(eq(s.cases.caseRef, a.caseRef));
    expect(cs.severity).toBe(1);
    expect(cs.summary).toMatch(/saved offline at/);
  });
});
