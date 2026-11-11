import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { generateSeed, type SeedOptions } from "./generate";

const TABLES_IN_DELETE_ORDER = [
  "events", "login_codes", "sos_cases_local_sync", "price_breakups", "provider_offers", "rule_validations", "rule_sets", "trip_versions", "trip_drafts", "offline_packs", "sms_messages", "cases", "confirmations", "change_quotes", "tool_calls", "agent_messages",
  "agent_threads", "payments", "booking_items", "travellers", "bookings", "users", "transfers", "room_inventory", "hotels",
  "flights", "itinerary_days", "itineraries", "pois", "destinations",
];

export async function truncateAll(db: Db) {
  await db.execute(sql.raw(`TRUNCATE ${TABLES_IN_DELETE_ORDER.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`));
}

/** Clears only user-generated data (bookings, agent, cases, packs) and keeps the catalogue. */
export async function truncateUserData(db: Db) {
  const t = ["events", "login_codes", "sos_cases_local_sync", "price_breakups", "provider_offers", "rule_validations", "rule_sets", "trip_versions", "trip_drafts", "offline_packs", "sms_messages", "cases", "confirmations", "change_quotes", "tool_calls", "agent_messages", "agent_threads", "payments", "booking_items", "travellers", "bookings", "users"];
  await db.execute(sql.raw(`TRUNCATE ${t.map((x) => `"${x}"`).join(", ")} RESTART IDENTITY CASCADE`));
}

async function chunked<T>(rows: T[], size: number, fn: (c: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

export async function seedCatalogue(db: Db, opts: SeedOptions, log: (m: string) => void = () => {}) {
  const data = generateSeed(opts);
  log(`generated ${data.destinations.length} destinations, ${data.itineraries.length} itineraries, ${data.flights.length} flights, ${data.roomInventory.length} room rows`);
  await chunked(data.destinations, 500, (c) => db.insert(s.destinations).values(c));
  await chunked(data.pois, 500, (c) => db.insert(s.pois).values(c));
  await chunked(data.hotels, 500, (c) => db.insert(s.hotels).values(c));
  await chunked(data.transfers, 500, (c) => db.insert(s.transfers).values(c));
  await chunked(data.itineraries, 200, (c) => db.insert(s.itineraries).values(c));
  await chunked(data.itineraryDays, 300, (c) => db.insert(s.itineraryDays).values(c));
  log("catalogue inserted, loading inventory…");
  await chunked(data.roomInventory, 2000, (c) => db.insert(s.roomInventory).values(c));
  await chunked(data.flights, 2000, (c) => db.insert(s.flights).values(c));
  return data;
}
