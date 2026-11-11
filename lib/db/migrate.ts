import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb, dbKind, type Db } from "./client";

/** Drops everything and re-applies migrations. Neon: uses the migrator on the pooled connection. */
export async function resetSchema(): Promise<Db> {
  process.env.DB_NO_AUTO_MIGRATE = "1"; // reset drops everything first, so skip the connect-time migration
  const db = await getDb();
  for (const stmt of ["DROP SCHEMA IF EXISTS public CASCADE", "DROP SCHEMA IF EXISTS drizzle CASCADE", "CREATE SCHEMA public"]) {
    await db.execute(sql.raw(stmt));
  }
  const folder = path.join(process.cwd(), "drizzle");
  if (dbKind() === "neon") {
    const { migrate } = await import("drizzle-orm/neon-serverless/migrator");
    await migrate(db as never, { migrationsFolder: folder });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: folder });
  }
  return db;
}
