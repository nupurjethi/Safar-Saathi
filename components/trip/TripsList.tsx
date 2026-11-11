"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Card, EmptyState, LinkButton, Skeleton } from "@/components/ui/primitives";
import { HeroArt } from "@/components/ui/ItineraryCard";
import { PlacePhoto } from "@/components/ui/PlacePhoto";
import { tripPhotos } from "./TripHero";
import { savedPacks } from "@/lib/offline/dexie";
import { useNetwork } from "@/lib/offline/network-state";
import { fmtDate, inr } from "@/lib/time";
import { InstallAndLocation } from "./Landing";

type Trip = { status?: string; ref: string; title: string; startDate: string; endDate: string; pax: number; totalInr: number; packVersion: number; palette: [string, string]; saved: boolean; hero?: { src: string; credit: { title: string; author: string; license: string; licenseUrl: string; sourceUrl: string } } | null };

export function TripsList() {
  const { status } = useNetwork();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [auth, setAuth] = useState(true);
  useEffect(() => {
    let alive = true;
    (async () => {
      const saved = await savedPacks();
      const local: Trip[] = saved.map((s) => ({ ref: s.ref, title: s.pack.booking.title, startDate: s.pack.booking.dates[0], endDate: s.pack.booking.dates[1], status: s.pack.booking.status, pax: s.pack.booking.pax, totalInr: s.pack.booking.totalInr, packVersion: s.version, palette: ["#818CF8", "#1E1B4B"], saved: true, hero: ((p) => (p ? { src: p.image.src, credit: p.image } : null))(tripPhotos(s.pack)[0]) }));
      if (status !== "online") { if (alive) setTrips(local); return; }
      try {
        const r = await fetch("/api/trips");
        if (r.status === 401) { if (alive) { setAuth(false); setTrips(local); } return; }
        const j = await r.json();
        if (alive) { setAuth(true); setTrips((j.trips as Omit<Trip, "saved">[]).map((t) => ({ ...t, palette: t.palette, saved: saved.some((s) => s.ref === t.ref) }))); }
      } catch { if (alive) setTrips(local); }
    })();
    return () => { alive = false; };
  }, [status]);

  return (
    <div className="space-y-5">
      <h1 className="text-[32px] font-bold leading-tight">My trips</h1>
      {trips === null ? <div className="space-y-3"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
        : trips.length === 0 ? (
          <EmptyState title={auth ? "No trips yet" : "Sign in to see your trips"} body={auth ? "Book a sample trip and your offline guide is ready in under a minute." : status === "online" ? "Use the demo account to see a ready-made Paris to Rome trip." : "You are offline and nothing is saved on this phone yet."}
            action={auth ? <LinkButton href="/explore" variant="primary">Explore trips</LinkButton> : <LinkButton href="/login?next=/trips" variant="primary">Sign in</LinkButton>} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2" data-testid="trips">
            {trips.map((t) => (
              <li key={t.ref}>
                <Link href={`/trips/${t.ref}`} className="card block overflow-hidden transition hover:border-muted" data-testid="trip-card">
                  {t.hero ? <PlacePhoto src={t.hero.src} alt={`${t.title}: ${t.hero.credit.title}`} credit={t.hero.credit} className="h-40" linkCredit={false} /> : <HeroArt palette={t.palette} className="h-24" />}
                  <div className="space-y-1 p-4"><h2 className="text-[20px] font-semibold leading-snug">{t.title}</h2><div className="flex flex-wrap gap-2">{t.status === "draft" ? <Badge tone="warn">Draft · not paid</Badge> : null}{t.saved ? <Badge tone="ok">Offline ready</Badge> : <Badge>Not saved</Badge>}</div><p className="text-[15px] text-muted">{fmtDate(t.startDate)} to {fmtDate(t.endDate, true)} · {t.pax} travellers · {inr(t.totalInr)}</p><p className="font-mono text-[14px] text-muted">{t.ref}</p></div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      <section className="space-y-3"><h2 className="text-[20px] font-semibold">Set up your phone</h2><InstallAndLocation /></section>
      <Card className="text-[14px] text-muted">Trips and prices are sample data. Offline guides are saved on this phone and update when you are online.</Card>
    </div>
  );
}
