import { and, eq } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { isPlatformId, PLATFORM_IDS, type PlatformId } from "@/lib/providers/platforms";

/** Platforms the traveller says they are logged in to. Self-declared: it never holds a password, token or cookie. */
export async function connectedPlatforms(userId: string, dbIn?: Db): Promise<PlatformId[]> {
  const db = dbIn ?? (await getDb());
  const rows = await db.select().from(s.providerConnections).where(and(eq(s.providerConnections.userId, userId), eq(s.providerConnections.status, "connected")));
  return PLATFORM_IDS.filter((p) => rows.some((r) => r.provider === p));
}

export async function setConnected(userId: string, provider: string, connected: boolean, dbIn?: Db) {
  if (!isPlatformId(provider)) throw new Error("UNKNOWN_PLATFORM");
  const db = dbIn ?? (await getDb());
  await db.insert(s.providerConnections).values({ userId, provider, status: connected ? "connected" : "disconnected", markedAt: new Date() })
    .onConflictDoUpdate({ target: [s.providerConnections.userId, s.providerConnections.provider], set: { status: connected ? "connected" : "disconnected", markedAt: new Date(), updatedAt: new Date() } });
  await db.insert(s.events).values({ name: connected ? "platform_marked_logged_in" : "platform_marked_logged_out", userId, props: { provider } });
  return connectedPlatforms(userId, db);
}
