"use client";
import { CheckCircle2, CloudDownload, TriangleAlert } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { ago, fmtBytes } from "@/lib/trip/derive";
import { useTrip } from "./TripProvider";

export function OfflineStatus() {
  const t = useTrip();
  const m = t.stored?.manifest;
  const p = t.progress;
  const pct = p && p.totalBytes ? Math.min(100, Math.round((p.loadedBytes / p.totalBytes) * 100)) : 0;
  const tiles = t.pack?.map.cities.some((c) => c.pmtiles);
  return (
    <Card data-testid="offline-status" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {t.stored ? <CheckCircle2 className="text-ok" size={22} strokeWidth={1.75} /> : <CloudDownload className="text-muted" size={22} strokeWidth={1.75} />}
          <h2 className="text-[17px] font-semibold" data-testid="offline-ready">{t.stored ? "Offline guide ready" : "Offline guide not saved"}</h2>
        </div>
        {t.stored && <Badge tone="ok">v{t.stored.version}</Badge>}
      </div>
      {t.pack?.rulesMeta && <p className="text-[14px]" data-testid="rules-label"><Badge tone={t.pack.rulesMeta.origin === "template" ? "muted" : "ok"}>{t.pack.rulesMeta.label}</Badge></p>}
      {t.stored && m && (
        <p className="text-[15px] text-muted">
          {fmtBytes(m.totalBytes)} on this phone · Updated {ago(t.stored.syncedAt, t.now.getTime())}
          {t.persisted === false && " · Your phone may clear it if storage runs low"}
        </p>
      )}
      {t.syncing && p && (
        <div aria-live="polite">
          <p className="mb-1 text-[15px]">Downloading your offline guide: {fmtBytes(p.loadedBytes)} of {fmtBytes(p.totalBytes)}</p>
          <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted" data-testid="sync-groups"><li>{p.groups.details ? "✓" : "…"} Trip details, rules and routes</li><li>{p.groups.maps ? "✓" : "…"} Map files</li></ul>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-lime transition-all" style={{ width: `${pct}%` }} /></div>
        </div>
      )}
      {t.lastResult?.reason === "over-budget" && (
        <div className="flex items-start gap-2 rounded-xl border border-warn p-3 text-[15px]">
          <TriangleAlert className="mt-0.5 shrink-0 text-warn" size={18} />
          <div className="space-y-2"><p>{t.lastResult.message}</p><Button size="md" onClick={() => void t.sync(true, true)}>Download maps over Wi-Fi</Button></div>
        </div>
      )}
      {t.lastResult?.reason === "error" && <p className="text-warn">Could not update just now: {t.lastResult.message}. Your saved guide still works.</p>}
      {t.stored && !tiles && <p className="text-[14px] text-muted">Map tiles are not built yet (run <code className="font-mono">npm run tiles:build</code>). Saved routes and places still work offline on a plain background.</p>}
      {t.storage && t.storage.quota > 0 && t.stored && t.storage.quota - t.storage.usage < (m?.totalBytes ?? 0) * 2 && <p className="text-warn text-[15px]">Your phone is low on storage. Free some space so the guide stays saved.</p>}
      <div className="flex flex-wrap gap-2">
        {t.net === "online" && <Button size="md" disabled={t.syncing} onClick={() => void t.sync(!t.stored)}>{t.stored ? "Check for updates" : "Download offline guide"}</Button>}
        {t.net !== "online" && <p className="text-[15px] text-muted">You are offline. This guide still works. It updates when you are back online.</p>}
      </div>
    </Card>
  );
}
