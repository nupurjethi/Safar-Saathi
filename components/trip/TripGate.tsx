"use client";
import Link from "next/link";
import { Skeleton, EmptyState, Button } from "@/components/ui/primitives";
import { useTrip } from "./TripProvider";
import type { OfflinePack } from "@/lib/packs/types";

/** Renders children once the pack is in IndexedDB. Handles loading, "no pack yet" and "please sign in". */
export function TripGate({ children }: { children: (pack: OfflinePack) => React.ReactNode }) {
  const t = useTrip();
  if (t.pack) return <>{children(t.pack)}</>;
  if (t.status === "loading" || (t.syncing && t.status !== "unauth")) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading your trip">
        <Skeleton className="h-24" /><Skeleton className="h-40" /><Skeleton className="h-32" />
        {t.syncing && t.progress && <p className="text-muted">Downloading your offline guide…</p>}
      </div>
    );
  }
  if (t.status === "unauth") {
    return (
      <EmptyState title="Please sign in" body="Sign in once with data. After that your trip stays on this phone, even with no network." action={<Link className="inline-flex min-h-12 items-center rounded-xl bg-lime px-5 font-semibold text-lime-ink glow" href={`/login?next=/trips/${t.ref}`}>Sign in</Link>} />
    );
  }
  return (
    <EmptyState
      title={t.net === "online" ? "No offline guide on this phone yet" : "This trip is not saved on this phone"}
      body={t.net === "online" ? (t.lastResult?.message ?? "Download it now. It is ready in under a minute on 4G.") : "Open this trip once with mobile data or Wi-Fi to save the guide, map and contacts. Then it works with no network."}
      action={t.net === "online" ? <Button variant="primary" onClick={() => void t.sync(true)}>Download offline guide</Button> : undefined}
    />
  );
}
