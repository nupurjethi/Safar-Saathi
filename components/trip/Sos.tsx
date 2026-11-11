"use client";
import { LifeBuoy, MessageSquare, Phone, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TripGate } from "./TripGate";
import { useTrip } from "./TripProvider";
import { Badge, Button, Card, LinkButton } from "@/components/ui/primitives";
import { enqueue } from "@/lib/offline/outbox";
import { setHasSignal, useNetwork } from "@/lib/offline/network-state";
import { currentStay } from "@/lib/rules/context";
import { telHref } from "@/lib/trip/derive";
import type { OfflinePack } from "@/lib/packs/types";

const KINDS = [
  { id: "lost passport", label: "Lost passport" },
  { id: "medical help", label: "Medical" },
  { id: "stranded", label: "Stranded / unsafe" },
  { id: "other help", label: "Something else" },
];

export function Sos() {
  return <TripGate>{(pack) => <Inner pack={pack} />}</TripGate>;
}

function Inner({ pack }: { pack: OfflinePack }) {
  const t = useTrip();
  const { status, hasSignal } = useNetwork();
  const stay = currentStay(pack, t.now);
  const [kind, setKind] = useState(KINDS[0].id);
  const [sent, setSent] = useState<{ caseRef: string; at: number } | null>(null);
  const [queued, setQueued] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [left, setLeft] = useState(60);
  const [fromQueue, setFromQueue] = useState(false);
  const canCall = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent); // desktops cannot place calls
  const hotel = pack.places[stay.hotelId];
  const gateway = pack.contacts.sms_gateway;
  const body = useMemo(() => `SOS ${kind}. Booking ${pack.booking.ref}. ${stay.cityName}.`, [kind, pack.booking.ref, stay.cityName]);

  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent<string[]>).detail; if (d?.length) { setSent({ caseRef: d[0], at: Date.now() }); setQueued(false); setFromQueue(true); } };
    window.addEventListener("ss-sos-sent", h);
    return () => window.removeEventListener("ss-sos-sent", h);
  }, []);
  useEffect(() => {
    if (!sent) return;
    const i = setInterval(() => setLeft(Math.max(0, 60 - Math.round((Date.now() - sent.at) / 1000))), 1000);
    return () => clearInterval(i);
  }, [sent]);

  const sendOnline = async () => {
    setBusy(true); setErr(null);
    let loc: { lat?: number; lon?: number } = {};
    try {
      const p = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 2500, maximumAge: 60000 }));
      loc = { lat: p.coords.latitude, lon: p.coords.longitude };
    } catch {}
    try {
      const r = await fetch("/api/sos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingRef: pack.booking.ref, scenario: kind, ...loc }) });
      const j = await r.json();
      if (!r.ok) setErr(j.message ?? "Could not reach our team. Use the phone numbers below.");
      else { setSent({ caseRef: j.caseRef, at: Date.now() }); setLeft(60); }
    } catch { setErr("No connection. Use the phone numbers below."); }
    setBusy(false);
    void fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "sos_tap", props: { state: "online" } }) }).catch(() => {});
  };
  const queue = async () => {
    // saved on the phone with a local id and the time; uploaded to /api/cases when data returns (idempotent by local id)
    await enqueue({ ref: pack.booking.ref, kind: "sos", payload: { bookingRef: pack.booking.ref, scenario: kind, localId: crypto.randomUUID(), queuedAt: new Date().toISOString() } });
    setQueued(true);
  };

  return (
    <div className="space-y-5">
      <h1 className="text-[32px] font-bold leading-tight">SOS</h1>

      {/* show first, then act: the address card, then the nearest contact, then the steps */}
      <Card className="space-y-2" data-testid="sos-address-card">
        <p className="st-label text-[13px] font-semibold uppercase text-accent">Show this to a driver or police</p>
        <p className="text-[clamp(26px,6vw,40px)] font-semibold leading-snug">{hotel.address_local}</p>
        <p className="text-[15px] text-muted">{hotel.name} · {hotel.address}</p>
      </Card>
      <Card className="space-y-1" data-testid="sos-emergency">
        <p className="text-[13px] font-semibold uppercase text-muted">Emergency number in {stay.cityName}</p>
        <p className="font-mono text-[40px] font-semibold leading-none">{stay.emergency.general}</p>
        <p className="text-[15px] text-muted">Police {stay.emergency.police} · Ambulance {stay.emergency.ambulance}{!canCall ? " · This device cannot place calls. Use a phone." : ""}</p>
      </Card>

      <fieldset className="space-y-2"><legend className="mb-1 text-[15px] text-muted">What is happening?</legend>
        <div className="flex flex-wrap gap-2">{KINDS.map((k) => <button key={k.id} onClick={() => setKind(k.id)} aria-pressed={kind === k.id} className={`min-h-12 rounded-full border-[1.5px] px-4 font-semibold ${kind === k.id ? "border-danger bg-danger text-danger-ink" : "border-line bg-surface"}`}>{k.label}</button>)}</div>
      </fieldset>

      {sent ? (
        <Card className="space-y-2 border-danger" data-testid="sos-sent">
          <p className="flex items-center gap-2 text-[20px] font-semibold"><LifeBuoy className="text-danger" /> {fromQueue ? "Case sent." : "A person has been paged"}</p>
          <p>{fromQueue ? "Reference " : "Case ID "} <span className="font-mono font-semibold">{sent.caseRef}</span>. Target response: 60 seconds{left > 0 ? ` (${left} s left)` : ". Someone should reach you now."}</p>
          <p className="text-[15px] text-muted">Stay where you are if it is safe. The offline guide is still open for you.</p>
          <LinkButton href={`/trips/${pack.booking.ref}/guide`} size="lg">Open offline guide</LinkButton>
        </Card>
      ) : status === "online" ? (
        <div className="space-y-2">
          <Button variant="danger" size="xl" block onClick={sendOnline} disabled={busy} data-testid="sos-main">{busy ? "Calling for help…" : "Talk to a human"}</Button>
          <p className="text-[15px] text-muted">We open a severity-1 case and page a person on our team. We aim to reach you within 60 seconds.</p>
        </div>
      ) : status === "signal" || hasSignal ? (
        <div className="space-y-2">
          <a data-testid="sos-main" href={`sms:${gateway}?body=${encodeURIComponent(body)}`} className="inline-flex min-h-16 w-full items-center justify-center gap-2 rounded-xl bg-danger px-6 text-xl font-semibold text-danger-ink"><MessageSquare size={24} /> Send SOS text</a>
          <p className="rounded-xl border border-line p-3 text-[15px]">Your text app opens with this message. <strong>You tap Send yourself.</strong> A web app cannot send an SMS silently.</p>
          <p className="font-mono text-[15px] text-muted">{body}</p>
          <p className="text-[14px] text-muted">SMS uses cellular signal, not mobile data.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <Button variant="danger" size="xl" block onClick={queue} disabled={queued} data-testid="sos-main">{queued ? "Queued, will send when you have signal" : "Queue SOS"}</Button>
          <p className="flex items-start gap-2 rounded-xl border border-warn p-3 text-[15px]"><TriangleAlert className="mt-0.5 shrink-0 text-warn" size={18} /> SMS needs cellular signal. It does not work in airplane mode. {queued ? "Saved on this phone. Will send when you are back online." : "Your SOS will be saved on this phone and sent when you are back online."} Nobody on our team has been contacted yet.</p>
          <button onClick={() => setHasSignal(true)} className="min-h-11 text-accent underline" data-testid="i-have-signal">I have phone signal (bars) but no data</button>
        </div>
      )}
      {err && <p role="alert" className="text-danger">{err}</p>}

      <Card className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-[20px] font-semibold">Call now · {stay.cityName}</h2>{!stay.emergency.verified && <Badge tone="warn">Sample, confirm locally</Badge>}</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {([["Emergency", stay.emergency.general], ["Police", stay.emergency.police], ["Ambulance", stay.emergency.ambulance]] as const).map(([l, n]) => (
            canCall
              ? <LinkButton key={l} href={telHref(n)} size="xl" variant="secondary" className="flex-col !gap-0 py-2"><span className="text-[13px] font-normal text-muted">{l}</span><span className="flex items-center gap-1 font-mono"><Phone size={18} /> {n}</span></LinkButton>
              : <div key={l} className="flex min-h-16 flex-col items-center justify-center rounded-full border-[1.5px] border-line bg-surface-2 py-2"><span className="text-[13px] text-muted">{l}</span><span className="font-mono text-xl">{n}</span></div>
          ))}
        </div>
        <p className="text-[15px] text-muted">{stay.consulate.name}. <span className="font-mono">{stay.consulate.phone}</span> (sample)</p>
      </Card>

      <p className="text-[14px] text-muted">Help that needs no data: <Link className="text-accent underline" href={`/trips/${pack.booking.ref}/guide?s=lost-passport`}>Lost passport</Link> · <Link className="text-accent underline" href={`/trips/${pack.booking.ref}/guide?s=medical-help`}>Medical help</Link>. {pack.disclaimer}</p>
    </div>
  );
}
