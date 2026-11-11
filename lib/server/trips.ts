import { and, eq } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { GateError } from "@/lib/gate/errors";
import { publishPack } from "@/lib/packs/build";
import { refreshOfflinePack } from "@/lib/packs/refresh";
import { createBooking } from "./booking";

/**
 * Spec section 1, steps 3 to 5: the traveller SELECTS a trip. A draft trip (unpaid) is created and its offline
 * bundle is built right away: plan, places, contacts, routes, map references and the validated rule set.
 */
export async function selectTrip(input: { userId: string; slug: string; startDate: string; pax: number }, dbIn?: Db) {
  const db = dbIn ?? (await getDb());
  let created;
  try {
    created = await createBooking({ userId: input.userId, slug: input.slug, startDate: input.startDate, pax: input.pax, travellers: [], status: "draft" }, db);
  } catch (e) {
    const m = String(e instanceof Error ? e.message : e);
    if (m.startsWith("NO_INVENTORY")) throw new GateError("NO_AVAILABILITY", 409, "No sample flights on those dates. Try another start date.");
    if (m === "ITINERARY_NOT_FOUND") throw new GateError("NOT_FOUND", 404, "Itinerary not found.");
    throw e;
  }
  const t0 = Date.now();
  const pack = await publishPack(created.booking.id, db, { change: "Trip selected" });
  await db.update(s.tripDrafts).set({ status: "ready", updatedAt: new Date() }).where(eq(s.tripDrafts.bookingId, created.booking.id));
  return {
    ref: created.booking.ref, status: "draft" as const, totalInr: created.booking.totalInr, packVersion: pack.version, packBuildMs: Date.now() - t0,
    guide: { origin: pack.rulesOrigin },
  };
}

/** Dummy payment: turns the draft into a booking. It does not start the offline download (that already happened). */
export async function payTrip(input: { userId: string; ref: string; travellers: { name: string; ageBand: string; passportLast4?: string }[] }, dbIn?: Db) {
  const db = dbIn ?? (await getDb());
  const [b] = await db.select().from(s.bookings).where(eq(s.bookings.ref, input.ref)).limit(1);
  if (!b) throw new GateError("NOT_FOUND", 404, "Trip not found.");
  if (b.userId !== input.userId) throw new GateError("FORBIDDEN", 403, "That trip belongs to someone else.");
  if (b.status !== "draft") throw new GateError("QUOTE_NOT_OPEN", 409, "This trip is already booked.");
  if (input.travellers.length !== b.pax) throw new GateError("BAD_REQUEST", 400, `This trip is for ${b.pax} travellers.`);
  await db.transaction(async (tx0) => {
    const tx = tx0 as unknown as Db;
    await tx.update(s.bookings).set({ status: "confirmed", updatedAt: new Date() }).where(and(eq(s.bookings.id, b.id), eq(s.bookings.status, "draft")));
    await tx.insert(s.payments).values({ bookingId: b.id, method: "dummy", amountInr: b.totalInr, status: "paid" });
    await tx.insert(s.travellers).values(input.travellers.map((t) => ({ userId: input.userId, bookingId: b.id, name: t.name, ageBand: t.ageBand, passportLast4: t.passportLast4?.slice(-4) ?? null })));
    await tx.update(s.tripDrafts).set({ status: "booked", updatedAt: new Date() }).where(eq(s.tripDrafts.bookingId, b.id));
    await tx.insert(s.events).values({ name: "booking_created", userId: input.userId, bookingId: b.id, props: { ref: b.ref, totalInr: b.totalInr } });
  });
  // The pack now carries traveller names and the "booked" status. Rules are reused (nothing they are built on changed).
  const r = await refreshOfflinePack(b.id, "Payment confirmed", db);
  return { ref: b.ref, totalInr: b.totalInr, packVersion: r.version, guideUpdated: r.ok };
}
