"use client";
import { Check, ExternalLink, Plane } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button } from "@/components/ui/primitives";
import type { Review } from "./ReviewCard";

export type PlatformsPart = {
  t: "platforms"; bookingRef: string; itemId: string;
  flight: { flightNo: string; carrier: string; from: string; to: string; date: string; departsLocal: string; arrivesLocal: string; departIso: string; arriveIso: string; pnr: string; leg: string; pax: number };
  platforms: { id: string; name: string; searchUrl: string; manageUrl: string; connected: boolean }[];
};

const field = "mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-line bg-surface-2 px-3 text-[16px] text-ink";

/**
 * "Change your flight": Safar Saathi cannot log in to MakeMyTrip, Goibibo, Cleartrip or ixigo for you (they have no sign-in for other
 * apps), so each button opens that platform's own page where YOU log in. Then you record the new flight here and confirm.
 */
export function PlatformCard({ part, online, onReview }: { part: PlatformsPart; online: boolean; onReview: (card: Review) => void }) {
  const [connected, setConnected] = useState<Record<string, boolean>>(() => Object.fromEntries(part.platforms.map((p) => [p.id, p.connected])));
  const [platform, setPlatform] = useState(part.platforms.find((p) => p.connected)?.id ?? part.platforms[0].id);
  const [f, setF] = useState({ flightNo: "", carrierName: "", departLocal: part.flight.departIso, arriveLocal: part.flight.arriveIso, pnr: "", fareDiffInr: "0", changeFeeInr: "0" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // saved chat cards remember the state from when they were made: refresh which platforms are marked logged in
  useEffect(() => {
    if (!online) return;
    fetch("/api/providers/connect", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.connected) setConnected(Object.fromEntries(part.platforms.map((p) => [p.id, (j.connected as string[]).includes(p.id)]))); }).catch(() => {});
  }, [online, part.platforms]);

  const mark = async (id: string) => {
    const next = !connected[id];
    setConnected((c) => ({ ...c, [id]: next }));
    await fetch("/api/providers/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: id, connected: next }) }).catch(() => setConnected((c) => ({ ...c, [id]: !next })));
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/trips/${part.bookingRef}/external-change`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, itemId: part.itemId, flightNo: f.flightNo, carrierName: f.carrierName, departLocal: f.departLocal, arriveLocal: f.arriveLocal, pnr: f.pnr, fareDiffInr: Number(f.fareDiffInr || 0), changeFeeInr: Number(f.changeFeeInr || 0) }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.message ?? "Please check the details."); setBusy(false); return; }
      setSent(true); setBusy(false);
      onReview(j.card as Review);
    } catch { setErr("No connection. Recording a change needs data."); setBusy(false); }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const fl = part.flight;

  return (
    <section aria-label="Change your flight on your booking platform" data-testid="platform-card" className="card-2 space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[20px] font-semibold">Change your flight</h3>
        <Badge tone="warn">You log in on their site</Badge>
      </div>

      <div className="rounded-xl border-[1.5px] border-line bg-surface p-3" data-testid="platform-flight">
        <p className="flex items-center gap-2 font-semibold"><Plane size={18} className="text-accent" /> {fl.carrier} {fl.flightNo} · {fl.from} to {fl.to}</p>
        <p className="mt-1 text-[15px] text-muted">Departs {fl.departsLocal} · arrives {fl.arrivesLocal}</p>
        <p className="text-[15px] text-muted">Booking code <span className="font-mono">{fl.pnr}</span> · {fl.pax} travellers</p>
      </div>

      <p className="text-[15px]">MakeMyTrip, Goibibo, Cleartrip and ixigo do not let other apps sign in to your account or change a ticket for you, so <b>Safar Saathi never asks for your password</b> and cannot book on them. Log in on the platform where you bought this ticket, change it there, then come back and record the new flight below.</p>

      <div className="space-y-2">
        <p className="text-[15px] font-semibold">1. Open the platform and log in</p>
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="platform-list">
          {part.platforms.map((p) => (
            <li key={p.id} className={`space-y-2 rounded-xl border-[1.5px] p-3 ${connected[p.id] ? "border-lime" : "border-line"} bg-surface`} data-testid="platform-row" data-platform={p.id}>
              <div className="flex items-center justify-between gap-2"><span className="text-[17px] font-semibold">{p.name}</span>{connected[p.id] && <Badge tone="ok"><Check size={12} className="mr-1 inline" />Logged in</Badge>}</div>
              <div className="flex flex-wrap gap-2">
                <a href={p.searchUrl} target="_blank" rel="noopener noreferrer" data-testid="platform-open" className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border-[1.5px] border-line bg-surface-2 px-3 text-[15px] font-semibold hover:border-muted">Open flights <ExternalLink size={14} /></a>
                <a href={p.manageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border-[1.5px] border-line bg-surface-2 px-3 text-[15px] font-semibold hover:border-muted">My trips <ExternalLink size={14} /></a>
              </div>
              <button type="button" onClick={() => void mark(p.id)} aria-pressed={!!connected[p.id]} data-testid="platform-mark" className="min-h-11 w-full rounded-full text-[15px] font-medium text-accent underline">{connected[p.id] ? "Not logged in any more" : "I am logged in on this site"}</button>
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-muted">&quot;Logged in&quot; is your own note so we remember which platform you use. We cannot see or check your account. Links open each site&apos;s own pages in a new tab; if a page has moved, search there manually.</p>
      </div>

      <form onSubmit={submit} className="space-y-3" data-testid="platform-form">
        <p className="text-[15px] font-semibold">2. Tell us the new flight, as on your airline confirmation</p>
        <label className="block text-[15px] text-muted">Changed on
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={field} data-testid="pf-platform">{part.platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[15px] text-muted">Airline<input required value={f.carrierName} onChange={set("carrierName")} placeholder="IndiGo" autoComplete="off" className={field} data-testid="pf-carrier" /></label>
          <label className="block text-[15px] text-muted">Flight number<input required value={f.flightNo} onChange={set("flightNo")} placeholder="6E 143" autoCapitalize="characters" autoComplete="off" className={field} data-testid="pf-flightno" /></label>
          <label className="block text-[15px] text-muted">New departure (local time)<input required type="datetime-local" value={f.departLocal} onChange={set("departLocal")} className={field} data-testid="pf-depart" /></label>
          <label className="block text-[15px] text-muted">New arrival (local time)<input required type="datetime-local" value={f.arriveLocal} onChange={set("arriveLocal")} className={field} data-testid="pf-arrive" /></label>
          <label className="block text-[15px] text-muted">Booking code (PNR)<input required value={f.pnr} onChange={set("pnr")} placeholder="AB12CD" autoCapitalize="characters" autoComplete="off" className={`${field} font-mono`} data-testid="pf-pnr" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[15px] text-muted">Fare difference ₹<input inputMode="numeric" pattern="[0-9]*" value={f.fareDiffInr} onChange={set("fareDiffInr")} className={field} data-testid="pf-fare" /></label>
            <label className="block text-[15px] text-muted">Change fee ₹<input inputMode="numeric" pattern="[0-9]*" value={f.changeFeeInr} onChange={set("changeFeeInr")} className={field} data-testid="pf-fee" /></label>
          </div>
        </div>
        {err && <p role="alert" className="text-danger" data-testid="pf-error">{err}</p>}
        <Button type="submit" variant="primary" size="lg" block disabled={busy || !online || sent} data-testid="pf-submit">{sent ? "Review card is below" : busy ? "Checking…" : "Review this change"}</Button>
        <p className="text-[13px] text-muted">{online ? "Nothing changes yet. You will see a review card and must tap Yes." : "You are offline. Recording a change needs data."}</p>
      </form>
    </section>
  );
}
