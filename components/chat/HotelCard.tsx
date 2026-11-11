"use client";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Badge, Button } from "@/components/ui/primitives";
import { inr } from "@/lib/time";
import type { Review } from "./ReviewCard";
import { useSelectedPlatform } from "./platform-choice";

export type HotelsPart = {
  t: "hotels"; bookingRef: string; itemId: string; configured: boolean;
  /** true: sample prices from the Safar Saathi mock partner API (not live). */
  sample?: boolean;
  current: { name: string; city: string; address: string; checkin: string; checkout: string; rooms: number; lat: number; lon: number };
  query: { checkin: string; checkout: string; nights: number; rooms: number; adults: number; city: string };
  providers: { name: string; ok: boolean; count: number; error?: string }[];
  offers: { id: string; providerLabel: string; source: string; hotelName: string; address?: string; lat?: number; lon?: number; roomType?: string; totalInr: number; perNightInr: number; breakup: { label: string; amountInr: number }[]; refundable: boolean; cancellation?: string; validUntil: string; platformPrices?: { platform: string; name: string; totalInr: number; url: string }[] }[];
  cheapestId?: string;
  platforms: { id: string; name: string; hotelsUrl: string; connected: boolean }[];
};

const field = "mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-line bg-surface-2 px-3 text-[16px] text-ink";
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/**
 * "Change your stay": the agent compares live hotel prices from official APIs when one is configured. Either way the traveller
 * opens a platform (MakeMyTrip, Goibibo, Cleartrip, ixigo) from here, logs in and PAYS THERE, then records the booking below.
 * Safar Saathi cannot log in to those platforms, read their prices or take payment. The record goes through the Confirm gate.
 */
export function HotelCard({ part, online, onReview }: { part: HotelsPart; online: boolean; onReview: (card: Review) => void }) {
  const [pick, setPick] = useState<string | undefined>(part.configured ? part.cheapestId ?? part.offers[0]?.id : undefined);
  const chosen = part.offers.find((o) => o.id === pick);
  const selected = useSelectedPlatform();
  const selPlatform = part.platforms.find((p) => p.id === selected);
  const selPrice = chosen?.platformPrices?.find((p) => p.platform === selected);
  const [mode, setMode] = useState<"extend" | "replace">("extend");
  const [platform, setPlatform] = useState(part.platforms.find((p) => p.connected)?.id ?? part.platforms[0].id);
  const [checkout, setCheckout] = useState(part.query.checkout > part.current.checkout ? part.query.checkout : addDays(part.current.checkout, 1));
  const [checkin2, setCheckin2] = useState(part.query.checkin);
  const [checkout2, setCheckout2] = useState(part.query.checkout);
  const [rooms, setRooms] = useState(String(part.query.rooms));
  const [amount, setAmount] = useState(chosen ? String(chosen.totalInr) : "0");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const q = part.query;
  const canReplace = !!chosen && chosen.lat != null && chosen.lon != null; // a replacement needs the hotel's real location for the map pin
  const effMode = mode === "replace" && !canReplace ? "extend" : mode;
  const [phone, setPhone] = useState("");

  const details = `${q.city}, check-in ${q.checkin}, check-out ${q.checkout}, ${q.rooms} room${q.rooms > 1 ? "s" : ""}, ${q.adults} guest${q.adults > 1 ? "s" : ""}`;
  const copy = async () => { try { await navigator.clipboard.writeText(details); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard not available */ } };
  const choose = (id: string) => { setPick(id); const o = part.offers.find((x) => x.id === id); if (o) setAmount(String(o.totalInr)); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const common = { platform, itemId: part.itemId, amountPaidInr: Number(amount || 0), ...(code.trim() ? { confirmationCode: code.trim() } : {}) };
    const body = effMode === "extend"
      ? { mode: "extend", ...common, newCheckoutDate: checkout }
      : { mode: "replace", ...common, hotelName: chosen!.hotelName, address: chosen!.address ?? chosen!.hotelName, lat: chosen!.lat!, lon: chosen!.lon!, ...(phone.trim() ? { phone: phone.trim() } : {}), checkinDate: checkin2, checkoutDate: checkout2, rooms: Number(rooms) };
    try {
      const r = await fetch(`/api/trips/${part.bookingRef}/external-hotel-change`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { setErr(j.message ?? "Please check the details."); setBusy(false); return; }
      setSent(true); setBusy(false);
      onReview(j.card as Review);
    } catch { setErr("No connection. Recording a change needs data."); setBusy(false); }
  };

  return (
    <section aria-label="Change your hotel stay" data-testid="hotels-card" className="card-2 space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[20px] font-semibold">Change your stay</h3>
        <Badge tone={part.configured && !part.sample ? "ok" : "warn"}>{part.sample ? "Sample prices" : part.configured ? "Live prices" : "You pay on their site"}</Badge>
      </div>

      <div className="rounded-xl border-[1.5px] border-line bg-surface p-3" data-testid="hotel-current">
        <p className="font-semibold">{part.current.name}</p>
        <p className="text-[15px] text-muted">{part.current.city} · {fmt(part.current.checkin)} to {fmt(part.current.checkout)} · {part.current.rooms} room{part.current.rooms > 1 ? "s" : ""}</p>
      </div>

      {part.configured && part.offers.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[15px] font-semibold">Compare hotels</p>
          <p className="text-[15px] text-muted">{q.city} · {fmt(q.checkin)} to {fmt(q.checkout)} · {q.nights} night{q.nights > 1 ? "s" : ""} · {q.rooms} room{q.rooms > 1 ? "s" : ""} · from {part.providers.filter((p) => p.ok).map((p) => p.name).join(" + ") || "no source"}{part.providers.some((p) => !p.ok) ? ` (${part.providers.filter((p) => !p.ok).map((p) => p.name).join(", ")} did not answer)` : ""}</p>
          <ul className="space-y-2" role="radiogroup" aria-label="Hotel options" data-testid="hotel-offers">
            {part.offers.map((o) => (
              <li key={o.id}>
                <button type="button" role="radio" aria-checked={pick === o.id} onClick={() => choose(o.id)} data-testid="hotel-offer" className={`w-full rounded-xl border-[1.5px] p-3 text-left ${pick === o.id ? "border-lime bg-surface" : "border-line bg-surface-2"}`}>
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{o.hotelName}</span>
                    <span className="font-display text-[22px] font-bold">{inr(o.totalInr)}</span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 text-[15px] text-muted">
                    <span>{o.roomType ?? "Room"}</span><span>{inr(o.perNightInr)} per night</span>
                  </span>
                  {o.cancellation && <span className="mt-0.5 block text-[14px] text-muted">{o.cancellation}</span>}
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    {o.id === part.cheapestId && <Badge tone="lime">Cheapest</Badge>}
                    <Badge tone={o.refundable ? "ok" : "muted"}>{o.refundable ? "Refundable" : "Not refundable"}</Badge>
                    <span className="text-[12px] text-muted">{o.providerLabel}</span>
                  </span>
                  <span className="mt-1 block text-[12px] text-muted">{o.source}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-muted" data-testid="hotel-source">{part.sample ? "Sample prices from the Safar Saathi mock partner API, not live prices. The per-platform prices are samples too: check the real price on the platform before you pay." : "Reference prices from official hotel price APIs. MakeMyTrip, Goibibo, Cleartrip and ixigo can show a different price for the same hotel, so check it there before you pay."}</p>
        </div>
      ) : (
        <p className="rounded-xl border border-warn p-3 text-[15px]" data-testid="hotel-no-source">
          {part.configured ? "No hotels came back for those dates. Try other dates, or open a platform below and search there." : `No live hotel price source is connected, so I cannot compare prices. Open a platform, search for ${q.city}, ${fmt(q.checkin)} to ${fmt(q.checkout)}, ${q.rooms} room${q.rooms > 1 ? "s" : ""}, compare there and pay there.`}
        </p>
      )}

      <div className="space-y-2">
        {selPlatform ? (
          <a href={selPrice?.url ?? selPlatform.hotelsUrl} target="_blank" rel="noopener noreferrer" data-testid="pay-on-platform" className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-lime px-4 text-center text-[16px] font-bold text-lime-ink">
            Pay on {selPlatform.name}{selPrice ? ` · ${inr(selPrice.totalInr)}${part.sample ? " (sample)" : ""}` : ""} <ExternalLink size={16} />
          </a>
        ) : <p className="rounded-xl border border-warn p-3 text-[15px]" data-testid="pay-choose-platform">Choose the platform you are logged in to at the top of the chat, and I will open it for you to book and pay.</p>}
        <p className="text-[15px] font-semibold">{chosen?.platformPrices ? "Sample price on each platform" : "Book it where you like, and pay there"}</p>
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="hotel-platforms">
          {part.platforms.map((p) => {
            const price = chosen?.platformPrices?.find((x) => x.platform === p.id);
            return (
              <li key={p.id}>
                <a href={price?.url ?? p.hotelsUrl} target="_blank" rel="noopener noreferrer" data-testid="hotel-platform-open" className={`flex min-h-12 items-center justify-between gap-2 rounded-xl border-[1.5px] bg-surface px-3 text-[16px] font-semibold hover:border-muted ${p.id === selected ? "border-lime" : "border-line"}`}>
                  <span>{p.name}{p.id === selected ? <span className="ml-2 text-[13px] font-normal text-ok">logged in</span> : null}</span>
                  <span className="inline-flex items-center gap-2">{price ? inr(price.totalInr) : null}<ExternalLink size={16} /></span>
                </a>
              </li>
            );
          })}
        </ul>
        <div className="rounded-xl border-[1.5px] border-line bg-surface p-3" data-testid="hotel-details">
          <p className="text-[13px] text-muted">Details to enter on the platform</p>
          <p className="mt-0.5 text-[15px]">{details}</p>
          <button type="button" onClick={() => void copy()} className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-accent underline underline-offset-4">{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Copied" : "Copy"}</button>
        </div>
        <p className="text-[13px] text-muted">Each link opens that platform&apos;s own hotel page. We cannot log in to those platforms, read their prices or take payment, and we never see your password. Log in on their site and pay there.</p>
      </div>

      <form onSubmit={submit} className="space-y-3" data-testid="hotel-form">
        <p className="text-[15px] font-semibold">After you have booked</p>
        <fieldset className="space-y-2">
          <legend className="sr-only">What did you book?</legend>
          <label className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-[1.5px] px-3 ${effMode === "extend" ? "border-lime bg-surface" : "border-line bg-surface-2"}`}>
            <input type="radio" name={`mode-${part.itemId}`} checked={effMode === "extend"} onChange={() => setMode("extend")} className="size-5 accent-[var(--lime)]" data-testid="hf-mode-extend" />
            <span className="text-[16px]">Stay longer at my current hotel</span>
          </label>
          <label className={`flex min-h-12 items-center gap-3 rounded-xl border-[1.5px] px-3 ${canReplace ? "cursor-pointer" : "cursor-not-allowed opacity-50"} ${effMode === "replace" ? "border-lime bg-surface" : "border-line bg-surface-2"}`}>
            <input type="radio" name={`mode-${part.itemId}`} checked={effMode === "replace"} disabled={!canReplace} onChange={() => setMode("replace")} className="size-5 accent-[var(--lime)]" data-testid="hf-mode-replace" />
            <span className="text-[16px]">Move to the hotel I chose{chosen ? `: ${chosen.hotelName}` : " (pick one above)"}</span>
          </label>
        </fieldset>

        {effMode === "extend" ? (
          <label className="block text-[15px] text-muted">New check-out date
            <input required type="date" value={checkout} min={addDays(part.current.checkout, 1)} max={addDays(part.current.checkout, 14)} onChange={(e) => setCheckout(e.target.value)} className={field} data-testid="hf-checkout" />
          </label>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-[15px] text-muted">Check-in<input required type="date" value={checkin2} onChange={(e) => setCheckin2(e.target.value)} className={field} data-testid="hf-checkin2" /></label>
            <label className="block text-[15px] text-muted">Check-out<input required type="date" value={checkout2} min={checkin2} onChange={(e) => setCheckout2(e.target.value)} className={field} data-testid="hf-checkout2" /></label>
            <label className="block text-[15px] text-muted">Rooms<input required inputMode="numeric" pattern="[0-9]*" value={rooms} onChange={(e) => setRooms(e.target.value)} className={field} data-testid="hf-rooms" /></label>
            <label className="block text-[15px] text-muted sm:col-span-3">Hotel phone (optional, for your offline guide)<input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 …" autoComplete="off" className={field} data-testid="hf-phone" /></label>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[15px] text-muted">Booked on
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={field} data-testid="hf-platform">{part.platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
          <label className="block text-[15px] text-muted">Amount you paid (₹)
            <input required inputMode="numeric" pattern="[0-9]*" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} data-testid="hf-amount" />
          </label>
        </div>
        <label className="block text-[15px] text-muted">Confirmation code (optional)
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="From the hotel email" autoCapitalize="characters" autoComplete="off" maxLength={20} className={`${field} font-mono`} data-testid="hf-code" />
        </label>
        {err && <p role="alert" className="text-danger" data-testid="hf-error">{err}</p>}
        <Button type="submit" variant="primary" size="lg" block disabled={busy || !online || sent} data-testid="hf-submit">{sent ? "Review card is below" : busy ? "Checking…" : "Review this change"}</Button>
        <p className="text-[13px] text-muted">{online ? "Nothing changes yet. You will see a review card and must tap Yes." : "You are offline. Recording a change needs data."}</p>
      </form>
    </section>
  );
}
