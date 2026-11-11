"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, LinkButton, Skeleton } from "@/components/ui/primitives";
import { HeroArt } from "@/components/ui/ItineraryCard";
import { PlacePhoto } from "@/components/ui/PlacePhoto";
import { tripPhotos } from "./TripHero";
import { Trash2 } from "lucide-react";
import { deleteTrip as deleteLocal, savedPacks } from "@/lib/offline/dexie";
import { useNetwork } from "@/lib/offline/network-state";
import { fmtDate, inr } from "@/lib/time";
import { InstallAndLocation } from "./Landing";

type Trip = { status?: string; ref: string; title: string; startDate: string; endDate: string; pax: number; totalInr: number; packVersion: number; palette: [string, string]; saved: boolean; hero?: { src: string; credit: { title: string; author: string; license: string; licenseUrl: string; sourceUrl: string } } | null };

export function TripsList() {
  const { status } = useNetwork();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [auth, setAuth] = useState(true);
  const [confirm, setConfirm] = useState<Trip | null>(null);
  const [busy, setBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  const remove = async (t: Trip) => {
    setBusy(true); setDelErr(null);
    try {
      if (status === "online") {
        const r = await fetch(`/api/trips/${t.ref}`, { method: "DELETE" });
        if (!r.ok) { setDelErr((await r.json().catch(() => ({}))).message ?? "Could not delete this trip."); setBusy(false); return; }
      }
      await deleteLocal(t.ref); // also clears the saved guide, map and photos from this phone
      setTrips((all) => (all ?? []).filter((x) => x.ref !== t.ref));
      setConfirm(null);
    } catch { setDelErr("Something went wrong. Try again."); }
    setBusy(false);
  };
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
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-[32px] font-bold leading-tight">My trips</h1><LinkButton href="/plans/new" variant="primary" size="md" data-testid="add-plan-btn">Add travel plan</LinkButton></div>
      {trips === null ? <div className="space-y-3"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
        : trips.length === 0 ? (
          <EmptyState title={auth ? "No trips yet" : "Sign in to see your trips"} body={auth ? "Book a sample trip and your offline guide is ready in under a minute." : status === "online" ? "Use the demo account to see a ready-made Paris to Rome trip." : "You are offline and nothing is saved on this phone yet."}
            action={auth ? <LinkButton href="/explore" variant="primary">Explore trips</LinkButton> : <LinkButton href="/login?next=/trips" variant="primary">Sign in</LinkButton>} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2" data-testid="trips">
            {trips.map((t) => (
              <li key={t.ref} className="relative">
                <Link href={`/trips/${t.ref}`} className="card block overflow-hidden transition hover:border-muted" data-testid="trip-card">
                  {t.hero ? <PlacePhoto src={t.hero.src} alt={`${t.title}: ${t.hero.credit.title}`} credit={t.hero.credit} className="h-40" linkCredit={false} /> : <HeroArt palette={t.palette} className="h-24" />}
                  <div className="space-y-1 p-4"><h2 className="text-[20px] font-semibold leading-snug">{t.title}</h2><div className="flex flex-wrap gap-2">{t.status === "draft" ? <Badge tone="warn">Draft · not paid</Badge> : null}{t.saved ? <Badge tone="ok">Offline ready</Badge> : <Badge>Not saved</Badge>}</div><p className="text-[15px] text-muted">{fmtDate(t.startDate)} to {fmtDate(t.endDate, true)} · {t.pax} travellers · {inr(t.totalInr)}</p><p className="font-mono text-[14px] text-muted">{t.ref}</p></div>
                </Link>
                <button type="button" onClick={() => { setDelErr(null); setConfirm(t); }} aria-label={`Delete ${t.title}`} data-testid="delete-trip" className="absolute right-2 top-2 grid size-11 place-items-center rounded-full bg-black/65 text-white backdrop-blur hover:bg-danger"><Trash2 size={18} /></button>
              </li>
            ))}
          </ul>
        )}
      {confirm && (
        <div role="dialog" aria-modal="true" aria-labelledby="del-title" className="fixed inset-0 z-50 grid place-items-end bg-black/70 p-3 sm:place-items-center" data-testid="delete-dialog">
          <div className="card w-full max-w-md space-y-3 p-5">
            <h2 id="del-title" className="text-[22px] font-semibold">Delete this trip?</h2>
            <p className="text-[16px]"><b>{confirm.title}</b> ({confirm.ref}) will be deleted for good: its plan, chat, offline guide and map{status === "online" ? "" : ", from this phone only because you are offline. It stays on your account until you delete it online too"}. This cannot be undone.</p>
            {delErr && <p role="alert" className="text-danger">{delErr}</p>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="danger" size="lg" block disabled={busy} onClick={() => void remove(confirm)} data-testid="delete-confirm">{busy ? "Deleting…" : "Yes, delete it"}</Button>
              <Button size="lg" block disabled={busy} onClick={() => setConfirm(null)} data-testid="delete-cancel">Keep it</Button>
            </div>
          </div>
        </div>
      )}
      <section className="space-y-3"><h2 className="text-[20px] font-semibold">Set up your phone</h2><InstallAndLocation /></section>
      <Card className="text-[14px] text-muted">Trips and prices are sample data. Offline guides are saved on this phone and update when you are online.</Card>
    </div>
  );
}
