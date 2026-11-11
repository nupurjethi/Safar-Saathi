import { and, eq, sql } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { GateError } from "@/lib/gate/errors";

type FkRow = { child: string; col: string };

/** Delete rows and, first, every row anywhere that points at them (found from the database's own foreign keys). */
async function deleteCascade(db: Db, table: string, col: string, ids: string[], depth = 0): Promise<void> {
  if (!ids.length || depth > 6) return;
  const fks = (await db.execute(sql`select cl.relname as child, a.attname as col from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_class pt on pt.oid = c.confrelid join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] where c.contype = 'f' and pt.relname = ${table}`)) as unknown as { rows: FkRow[] } | FkRow[];
  for (const f of Array.isArray(fks) ? fks : fks.rows) {
    const sub = (await db.execute(sql.raw(`select id from "${f.child}" where "${f.col}" = any(array[${ids.map((i) => `'${i}'::uuid`).join(",")}])`))) as unknown as { rows: { id: string }[] } | { id: string }[];
    const subIds = (Array.isArray(sub) ? sub : sub.rows).map((r) => r.id);
    await deleteCascade(db, f.child, "id", subIds, depth + 1);
  }
  await db.execute(sql.raw(`delete from "${table}" where "${col}" = any(array[${ids.map((i) => `'${i}'::uuid`).join(",")}])`));
}

/** Permanently delete one of the signed-in user's trips (booking, plan, chat, packs, cases, generated map files). */
export async function deleteTripForUser(userId: string, ref: string, dbIn?: Db) {
  const db = dbIn ?? (await getDb());
  const [b] = await db.select().from(s.bookings).where(and(eq(s.bookings.ref, ref), eq(s.bookings.userId, userId))).limit(1);
  if (!b) throw new GateError("NOT_FOUND", 404, "Trip not found.");
  const planId = b.planId;
  await deleteCascade(db, "bookings", "id", [b.id]);
  if (planId) {
    await db.delete(s.mapTiles).where(sql`${s.mapTiles.key} like ${`plan-${planId.slice(0, 8)}-%`}`);
    await deleteCascade(db, "travel_plans", "id", [planId]);
  }
  await db.insert(s.events).values({ name: "trip_deleted", userId, props: { ref, source: b.source } });
  return { deleted: ref };
}
