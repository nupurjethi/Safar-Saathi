import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { createDemoBooking, createDemoUsers } from "@/lib/seed/demo";
import { seedCatalogue } from "@/lib/seed/insert";

process.env.PGLITE_DIR = "memory://";

export const BASE_DATE = new Date().toISOString().slice(0, 10);

/** Fresh in-memory Postgres with a small catalogue (21 days of inventory) and Neha's demo booking. */
export async function setupDb() {
  const db = await getDb();
  await seedCatalogue(db, { baseDate: BASE_DATE, flightDays: 21 });
  const { neha } = await createDemoUsers(db);
  const { booking, pack } = await createDemoBooking(db, neha.id, BASE_DATE, 5);
  return { db, neha, booking, pack };
}

export async function items(bookingId: string) {
  const db = await getDb();
  return db.select().from(s.bookingItems).where(eq(s.bookingItems.bookingId, bookingId));
}
