"use client";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card, ErrorState, LinkButton, Skeleton } from "@/components/ui/primitives";
import { InstallPrompt } from "@/components/ui/InstallPrompt";
import { fmtDate, inr } from "@/lib/time";

type Trav = { name: string; ageBand: "child" | "teen" | "adult" | "senior"; passportLast4: string };
type Booking = { ref: string; title: string; pax: number; status: string; startDate: string; endDate: string; totalInr: number };
type Item = { kind: string; priceInr: number };

/** Pay for a trip you already selected. The offline guide was saved at selection, so payment does not start a download. */
export function Checkout() {
  const sp = useSearchParams();
  const router = useRouter();
  const ref = sp.get("ref") ?? "";
  const [me, setMe] = useState<{ name: string } | null | undefined>(undefined);
  const [b, setB] = useState<Booking | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [travs, setTravs] = useState<Trav[]>([]);
  const [step, setStep] = useState<"travellers" | "pay" | "done">("travellers");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ totalInr: number; packVersion: number } | null>(null);

  useEffect(() => { fetch("/api/me").then((r) => r.json()).then((j) => setMe(j.user)).catch(() => setMe(null)); }, []);
  useEffect(() => {
    if (!ref || me === undefined || me === null) return;
    fetch(`/api/mock/v1/bookings/${ref}`).then(async (r) => {
      if (!r.ok) { setErr("We could not find that trip."); return; }
      const j = await r.json();
      setB(j.booking); setItems(j.items);
      setTravs(Array.from({ length: j.booking.pax }, () => ({ name: "", ageBand: "adult" as const, passportLast4: "" })));
      if (j.booking.status === "confirmed") router.replace(`/trips/${ref}`);
    }).catch(() => setErr("No connection."));
  }, [ref, me, router]);

  const valid = travs.length > 0 && travs.every((t) => t.name.trim().length > 1 && (!t.passportLast4 || /^\d{4}$/.test(t.passportLast4)));
  const pay = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/trips/${ref}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ travellers: travs.map((t) => ({ name: t.name.trim(), ageBand: t.ageBand, ...(t.passportLast4 ? { passportLast4: t.passportLast4 } : {}) })), payment: { method: "dummy" } }) });
      const j = await res.json();
      if (!res.ok) { setErr(j.message ?? "Could not book."); setBusy(false); return; }
      setDone(j); setStep("done"); setBusy(false);
    } catch { setErr("No connection. You were not charged."); setBusy(false); }
  };

  if (me === undefined) return <Skeleton className="h-96" />;
  if (!ref) return <ErrorState title="No trip selected" body="Select a trip first. Its offline guide is saved on your phone before you pay." retry={() => router.push("/")} />;
  if (me === null) return <Card className="mx-auto max-w-lg space-y-3 text-center"><h1 className="text-[24px] font-semibold">Sign in to book</h1><LinkButton href={`/login?next=${encodeURIComponent(`/checkout?ref=${ref}`)}`} variant="primary">Sign in</LinkButton></Card>;
  if (err && !b) return <ErrorState body={err} retry={() => router.push("/trips")} />;
  if (!b) return <Skeleton className="h-96" />;

  if (step === "done" && done) {
    return (
      <div className="mx-auto max-w-lg space-y-4" data-testid="booking-success">
        <Card className="space-y-2 border-ok"><p className="flex items-center gap-2 text-[24px] font-semibold"><CheckCircle2 className="text-ok" /> You are booked</p><p>Booking <span className="font-mono font-bold" data-testid="booking-ref">{ref}</span> · {inr(done.totalInr)}</p><p className="text-[15px] text-muted">Test payment. No money moved. Sample data. Your offline guide was already saved when you selected the trip.</p></Card>
        <Card className="space-y-2"><h2 className="text-[17px] font-semibold">Install the app</h2><InstallPrompt /></Card>
        <div className="grid gap-2 sm:grid-cols-2"><LinkButton href={`/trips/${ref}`} variant="primary" size="lg" data-testid="go-trip">Go to my trip</LinkButton><LinkButton href={`/trips/${ref}/voucher`} size="lg">View voucher</LinkButton></div>
      </div>
    );
  }

  const by = (k: string) => items.filter((i) => i.kind === k).reduce((a, i) => a + i.priceInr, 0);
  const lines = [["Flights", by("flight")], ["Hotels", by("hotel")], ["Airport transfers", by("transfer")], ["Activities", by("activity")]] as const;
  return (
    <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <h1 className="text-[32px] font-bold leading-tight">{step === "travellers" ? "Who is travelling?" : "Review and pay"}</h1>
        {step === "travellers" ? (
          <>
            {travs.map((t, i) => (
              <Card key={i} className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_130px_110px]">
                <label className="col-span-2 text-[15px] text-muted sm:col-span-1">Name as on passport<input value={t.name} onChange={(e) => setTravs((a) => a.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} className="mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-line bg-surface-2 px-3 text-[17px] text-ink" autoComplete="off" data-testid={`trav-name-${i}`} /></label>
                <label className="text-[15px] text-muted">Age<select value={t.ageBand} onChange={(e) => setTravs((a) => a.map((x, k) => (k === i ? { ...x, ageBand: e.target.value as Trav["ageBand"] } : x)))} className="mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-line bg-surface-2 px-2 text-[17px] text-ink"><option value="child">Child</option><option value="teen">Teen</option><option value="adult">Adult</option><option value="senior">Senior</option></select></label>
                <label className="text-[15px] text-muted">Passport last 4<input inputMode="numeric" maxLength={4} value={t.passportLast4} onChange={(e) => setTravs((a) => a.map((x, k) => (k === i ? { ...x, passportLast4: e.target.value.replace(/\D/g, "") } : x)))} placeholder="Optional" className="mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-line bg-surface-2 px-3 text-[17px] text-ink" /></label>
              </Card>
            ))}
            <p className="text-[14px] text-muted">This trip is for {b.pax} traveller{b.pax > 1 ? "s" : ""}. We keep only the last 4 digits of a passport number. Never enter a full passport number or card details here.</p>
            <Button variant="primary" block disabled={!valid} onClick={() => setStep("pay")} data-testid="to-pay" className="sm:w-auto">Continue</Button>
          </>
        ) : (
          <>
            <Card className="space-y-2"><h2 className="text-[20px] font-semibold">Test payment</h2><p className="rounded-xl border border-warn p-3 text-[15px]">This is a test payment. <strong>No money moves.</strong> Do not enter any real card details. There is nothing to enter.</p><p className="text-muted">Pay with: Dummy payment</p></Card>
            {err && <p role="alert" className="text-danger">{err}</p>}
            <div className="flex gap-2"><Button onClick={() => setStep("travellers")}>Back</Button><Button variant="primary" size="lg" className="flex-1 sm:flex-none" onClick={pay} disabled={busy} data-testid="pay-btn">{busy ? "Booking…" : `Test pay ${inr(b.totalInr)}`}</Button></div>
          </>
        )}
      </div>
      <aside><Card className="space-y-3 lg:sticky lg:top-24">
        <h2 className="text-[20px] font-semibold">{b.title}</h2>
        <p className="text-[15px] text-muted">{fmtDate(b.startDate)} to {fmtDate(b.endDate)} · {b.pax} travellers</p>
        <dl className="space-y-1.5">{lines.map(([l, a]) => <div key={l} className="flex justify-between"><dt className="text-muted">{l}</dt><dd>{inr(a)}</dd></div>)}<div className="flex justify-between border-t border-line pt-2 text-[20px] font-bold"><dt>Total</dt><dd className="font-display">{inr(b.totalInr)}</dd></div></dl>
        <p className="text-[13px] text-muted">Sample data. <Link href={`/trips/${ref}`} className="inline-flex min-h-11 items-center text-accent underline">Back to trip</Link></p>
      </Card></aside>
    </div>
  );
}
