import Dexie, { type Table } from "dexie";
import type { OfflinePack, PackManifest } from "@/lib/packs/types";

/**
 * IndexedDB "safar-saathi". Structured data lives here, big binaries (PMTiles) in per-trip Cache Storage namespaces.
 *  trips      one row per trip: which version is ACTIVE (the atomic-swap switch)
 *  tripPacks  versioned trip data: details, day plan, places, contacts, routes, map references
 *  rulesets   versioned, frozen, validated rule sets (read-only offline)
 *  fileRecs   verified file records (hash) per trip, for diffing and resume
 *  outbox     messages and SOS cases written offline
 */
export type TripRec = { ref: string; activeVersion: number; status: "draft" | "confirmed"; title: string; syncedAt: number; totalBytes: number };
export type PackRec = { ref: string; version: number; contentHash: string; pack: Omit<OfflinePack, "rules" | "rulesMeta" | "ruleSet">; manifest: PackManifest; savedAt: number };
export type RulesetRec = { ref: string; version: number; rules: OfflinePack["rules"]; rulesMeta: OfflinePack["rulesMeta"]; ruleSet: OfflinePack["ruleSet"] };
export type FileRec = { ref: string; url: string; hash?: string; bytes: number; version: number; cachedAt: number };
export type OutboxItem = { id?: number; ref: string; kind: "chat" | "sos"; payload: Record<string, unknown>; createdAt: number };
export type StoredPack = { ref: string; version: number; contentHash: string; pack: OfflinePack; manifest: PackManifest; syncedAt: number };

class SafarDb extends Dexie {
  trips!: Table<TripRec, string>;
  tripPacks!: Table<PackRec, [string, number]>;
  rulesets!: Table<RulesetRec, [string, number]>;
  fileRecs!: Table<FileRec, [string, string]>;
  outbox!: Table<OutboxItem, number>;
  settings!: Table<{ key: string; value: unknown }, string>;
  constructor() {
    super("safar-saathi");
    this.version(1).stores({ packs: "ref", files: "url, ref", outbox: "++id, ref, kind", meta: "key" });
    this.version(2).stores({
      packs: null, files: null, meta: null,
      trips: "ref", tripPacks: "[ref+version], ref", rulesets: "[ref+version], ref", fileRecs: "[ref+url], ref", outbox: "++id, ref, kind", settings: "key",
    });
  }
}

let _db: SafarDb | null = null;
export function offlineDb(): SafarDb {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is not available");
  return (_db ??= new SafarDb());
}
/** Tests: forget the cached connection. */
export function __resetOfflineDb() { _db?.close(); _db = null; }

/** The ACTIVE version of a trip, reassembled from the versioned stores. */
export async function getStored(ref: string): Promise<StoredPack | null> {
  const db = offlineDb();
  const t = await db.trips.get(ref);
  if (!t) return null;
  const [p, r] = await Promise.all([db.tripPacks.get([ref, t.activeVersion]), db.rulesets.get([ref, t.activeVersion])]);
  if (!p || !r) return null;
  const pack = { ...p.pack, rules: r.rules, rulesMeta: r.rulesMeta, ruleSet: r.ruleSet } as OfflinePack;
  return { ref, version: p.version, contentHash: p.contentHash, pack, manifest: p.manifest, syncedAt: t.syncedAt };
}

export async function savedPacks(): Promise<StoredPack[]> {
  try {
    const trips = await offlineDb().trips.toArray();
    return (await Promise.all(trips.map((t) => getStored(t.ref)))).filter((x): x is StoredPack => !!x);
  } catch {
    return [];
  }
}

/** Per-trip cache namespace for large files. Deleting a trip removes everything for it and nothing for other trips. */
export const tripCacheName = (ref: string, version: number) => `ss-trip-${ref}-v${version}`;
export const SHELL_CACHE = "ss-shell-v2";

export async function deleteTrip(ref: string) {
  const db = offlineDb();
  await db.transaction("rw", [db.trips, db.tripPacks, db.rulesets, db.fileRecs, db.outbox], async () => {
    await db.trips.delete(ref);
    await db.tripPacks.where("ref").equals(ref).delete();
    await db.rulesets.where("ref").equals(ref).delete();
    await db.fileRecs.where("ref").equals(ref).delete();
    await db.outbox.where("ref").equals(ref).delete();
  });
  if (typeof caches !== "undefined") for (const k of await caches.keys()) if (k.startsWith(`ss-trip-${ref}-v`)) await caches.delete(k);
}
