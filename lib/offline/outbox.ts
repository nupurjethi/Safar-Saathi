"use client";
import { offlineDb, type OutboxItem } from "./dexie";

export async function enqueue(item: Omit<OutboxItem, "id" | "createdAt">) {
  return offlineDb().outbox.add({ ...item, createdAt: Date.now() });
}
export async function pending(ref?: string, kind?: OutboxItem["kind"]) {
  const all = await offlineDb().outbox.toArray();
  return all.filter((o) => (!ref || o.ref === ref) && (!kind || o.kind === kind));
}
export async function remove(id: number) {
  await offlineDb().outbox.delete(id);
}

/** SOS taps made with no data are queued and sent as soon as the heartbeat succeeds. */
export async function flushSos(): Promise<string[]> {
  const sent: string[] = [];
  for (const it of await pending(undefined, "sos")) {
    try {
      const res = await fetch("/api/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...it.payload, localId: it.payload.localId ?? `local-${it.id}-${it.createdAt}`, queuedAt: it.payload.queuedAt ?? new Date(it.createdAt).toISOString() }) });
      if (res.ok) {
        const j = (await res.json()) as { caseRef: string };
        sent.push(j.caseRef);
        await remove(it.id!);
      } else if (res.status === 401 || res.status === 403) await remove(it.id!);
    } catch {
      break;
    }
  }
  return sent;
}
