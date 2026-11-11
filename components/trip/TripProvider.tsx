"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getStored, type StoredPack } from "@/lib/offline/dexie";
import { useNetwork, type NetStatus } from "@/lib/offline/network-state";
import { ensurePersistence, syncTrip, type SyncProgress, type SyncResult } from "@/lib/offline/sync";
import type { OfflinePack } from "@/lib/packs/types";

type Status = "loading" | "ready" | "missing" | "unauth";
type Ctx = {
  ref: string;
  stored: StoredPack | null;
  pack: OfflinePack | null;
  status: Status;
  syncing: boolean;
  progress: SyncProgress | null;
  lastResult: SyncResult | null;
  net: NetStatus;
  now: Date;
  persisted: boolean | null;
  storage: { usage: number; quota: number } | null;
  sync: (force?: boolean, allowOverBudget?: boolean) => Promise<SyncResult>;
};

const C = createContext<Ctx | null>(null);
export const useTrip = () => {
  const c = useContext(C);
  if (!c) throw new Error("useTrip outside TripProvider");
  return c;
};

export function TripProvider({ refCode, children }: { refCode: string; children: React.ReactNode }) {
  const { status: net } = useNetwork();
  const [stored, setStored] = useState<StoredPack | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    try {
      const rec = (await getStored(refCode)) ?? null;
      setStored(rec);
      setStatus((s) => (rec ? "ready" : s === "unauth" ? "unauth" : "missing"));
      return rec;
    } catch {
      setStatus((s) => (s === "unauth" ? s : "missing"));
      return null;
    }
  }, [refCode]);

  const sync = useCallback(async (force = false, allowOverBudget = false) => {
    if (busy.current) return { updated: false, version: 0, reason: "up-to-date" as const };
    busy.current = true;
    setSyncing(true);
    const res = await syncTrip(refCode, (p) => setProgress({ ...p }), { force, allowOverBudget });
    busy.current = false;
    setSyncing(false);
    setLastResult(res);
    if (res.reason === "unauthenticated") setStatus((s) => (s === "ready" ? s : "unauth"));
    const rec = await load();
    if (!rec && res.reason !== "unauthenticated") setStatus("missing");
    const p = await ensurePersistence();
    setPersisted(p.persisted);
    setStorage({ usage: p.usage, quota: p.quota });
    return res;
  }, [refCode, load]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  // Quietly re-sync whenever we are online (on arrival, when connectivity returns, and every 5 minutes).
  useEffect(() => {
    if (net !== "online") return;
    void sync();
    const t = setInterval(() => void sync(), 5 * 60_000);
    return () => clearInterval(t);
  }, [net, sync]);

  const value = useMemo<Ctx>(() => ({ ref: refCode, stored, pack: stored?.pack ?? null, status, syncing, progress, lastResult, net, now, persisted, storage, sync }), [refCode, stored, status, syncing, progress, lastResult, net, now, persisted, storage, sync]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
