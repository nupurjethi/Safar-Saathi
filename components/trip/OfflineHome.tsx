"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, LinkButton } from "@/components/ui/primitives";
import { savedPacks, type StoredPack } from "@/lib/offline/dexie";

/** Served by the service worker when a page is not saved. Lists the guides stored on this phone. */
export function OfflineHome() {
  const [packs, setPacks] = useState<StoredPack[] | null>(null);
  useEffect(() => { void savedPacks().then(setPacks); }, []);
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-[32px] font-bold leading-tight">You are offline</h1>
      <p className="text-muted">That page is not saved on this phone. Your trip guides are, and they work with no network.</p>
      {packs?.length ? packs.map((p) => (
        <Card key={p.ref} className="space-y-3"><h2 className="text-[20px] font-semibold">{p.pack.booking.title}</h2><p className="font-mono text-muted">{p.ref}</p>
          <div className="grid grid-cols-2 gap-2"><LinkButton href={`/trips/${p.ref}`} variant="primary" size="lg">My trip</LinkButton><LinkButton href={`/trips/${p.ref}/guide`} size="lg">Offline guide</LinkButton><LinkButton href={`/trips/${p.ref}/map`} size="lg">Map</LinkButton><LinkButton href={`/trips/${p.ref}/sos`} variant="danger" size="lg">SOS</LinkButton></div>
        </Card>
      )) : <Card>{packs ? "No trip is saved on this phone yet. Open your trip once with mobile data or Wi-Fi to save it." : "Looking for saved trips…"}</Card>}
      <p className="text-[14px] text-muted"><Link href="/" className="text-accent underline">Home</Link></p>
    </div>
  );
}
