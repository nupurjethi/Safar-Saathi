import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { selectTrip } from "@/lib/server/trips";
import { deleteTripForUser } from "@/lib/server/delete-trip";
import { addDays } from "@/lib/time";
import { setupDb, BASE_DATE } from "./helpers";

let c: Awaited<ReturnType<typeof setupDb>>;
beforeAll(async () => { c = await setupDb(); });

describe("delete a trip", () => {
  it("removes the trip and everything that hangs off it, only for its owner, and leaves other trips alone", async () => {
    const db = await getDb();
    const [it] = await db.select().from(s.itineraries).limit(1);
    const t = await selectTrip({ userId: c.neha.id, slug: it.slug, startDate: addDays(BASE_DATE, 4), pax: 2 }, db);
    const [b] = await db.select().from(s.bookings).where(eq(s.bookings.ref, t.ref));
    // some child data: a chat thread with a message, a case
    const [th] = await db.insert(s.agentThreads).values({ userId: c.neha.id, bookingId: b.id, channel: "app" }).returning();
    await db.insert(s.agentMessages).values({ threadId: th.id, role: "user", content: "hi" });
    await db.insert(s.cases).values({ caseRef: "SS-C-9999", bookingId: b.id, channel: "app", severity: 3, summary: "x", slaDueAt: new Date() });

    await expect(deleteTripForUser("00000000-0000-4000-8000-000000000000", t.ref)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await db.select().from(s.bookings).where(eq(s.bookings.ref, t.ref))).length).toBe(1);

    await deleteTripForUser(c.neha.id, t.ref);
    expect((await db.select().from(s.bookings).where(eq(s.bookings.ref, t.ref))).length).toBe(0);
    expect((await db.select().from(s.bookingItems).where(eq(s.bookingItems.bookingId, b.id))).length).toBe(0);
    expect((await db.select().from(s.offlinePacks).where(eq(s.offlinePacks.bookingId, b.id))).length).toBe(0);
    expect((await db.select().from(s.agentThreads).where(eq(s.agentThreads.bookingId, b.id))).length).toBe(0);
    expect((await db.select().from(s.cases).where(eq(s.cases.caseRef, "SS-C-9999"))).length).toBe(0);
    // the demo trip is untouched
    const [demo] = await db.select().from(s.bookings).where(eq(s.bookings.ref, c.booking.ref));
    expect(demo).toBeTruthy();
    expect((await db.select().from(s.bookingItems).where(eq(s.bookingItems.bookingId, demo.id))).length).toBeGreaterThan(0);
  });
});
