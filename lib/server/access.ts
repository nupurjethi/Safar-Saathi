import { eq, or } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { GateError } from "@/lib/gate/errors";
import type { Session } from "./session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every booking/pack read and write goes through here: session + ownership (staff may read). */
export async function bookingForSession(idOrRef: string, sess: Session) {
  const db = await getDb();
  const cond = UUID.test(idOrRef) ? or(eq(s.bookings.id, idOrRef), eq(s.bookings.ref, idOrRef)) : eq(s.bookings.ref, idOrRef);
  const [b] = await db.select().from(s.bookings).where(cond).limit(1);
  if (!b) throw new GateError("NOT_FOUND", 404, "Booking not found.");
  if (b.userId !== sess.uid && sess.role === "traveller") throw new GateError("FORBIDDEN", 403, "That booking belongs to someone else.");
  return b;
}
