"use client";
import { ExternalLink, Zap } from "lucide-react";
import { useState } from "react";
import { Badge, Button } from "@/components/ui/primitives";
import { inr } from "@/lib/time";
import type { PlatformsPart } from "./PlatformCard";

export type ComparePart = {
  t: "compare"; bookingRef: string; itemId: string;
  query: { from: string; to: string; date: string; pax: number };
  flight: PlatformsPart["flight"];
  providers: { name: string; ok: boolean; count: number; error?: string }[];
  offers: { id: string; providerLabel: string; source: string; totalInr: number; perTravellerInr: number; breakup: { label: string; amountInr: number }[]; facts: { carrier: string; flightNo: string; from: string; to: string; departLocal: string; arriveLocal: string; stops: number; durationMin?: number }; validUntil: string }[];
  cheapestId?: string; fastestId?: string;
  platforms: PlatformsPart["platforms"];
};

const hm = (iso: string) => iso.slice(11, 16);
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
const dur = (m?: number) => (m ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : "");

/**
 * The agent's price comparison: live fares from official price APIs, ranked. The traveller then opens the platform of their
 * choice (pre-filled), logs in and pays THERE, and comes back to record the booking. Safar Saathi cannot log in to those
 * platforms, read their prices or take payment.
 */
export function CompareCard({ part, online, onRecord }: { part: ComparePart; online: boolean; onRecord: (prefill: NonNullable<PlatformsPart["prefill"]>, part: ComparePart) => void }) {
  const [pick, setPick] = useState(part.cheapestId ?? part.offers[0]?.id);
  const chosen = part.offers.find((o) => o.id === pick) ?? part.offers[0];
  const [recorded, setRecorded] = useState(false);
  return (
    <section aria-label="Flight price comparison" data-testid="compare-card" className="card-2 space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[20px] font-semibold">Compare flights</h3>
        <Badge tone="ok">Live fares</Badge>
      </div>
      <p className="text-[15px] text-muted">{part.query.from} to {part.query.to} · {day(`${part.query.date}T00:00`)} · {part.query.pax} traveller{part.query.pax > 1 ? "s" : ""} · from {part.providers.filter((p) => p.ok).map((p) => p.name).join(" + ") || "no source"}{part.providers.some((p) => !p.ok) ? ` (${part.providers.filter((p) => !p.ok).map((p) => p.name).join(", ")} did not answer)` : ""}</p>

      {part.offers.length ? (
        <ul className="space-y-2" role="radiogroup" aria-label="Flight options" data-testid="compare-offers">
          {part.offers.map((o) => (
            <li key={o.id}>
              <button type="button" role="radio" aria-checked={pick === o.id} onClick={() => setPick(o.id)} data-testid="compare-offer" className={`w-full rounded-xl border-[1.5px] p-3 text-left ${pick === o.id ? "border-lime bg-surface" : "border-line bg-surface-2"}`}>
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{o.facts.carrier} {o.facts.flightNo}</span>
                  <span className="font-display text-[22px] font-bold">{inr(o.totalInr)}</span>
                </span>
                <span className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 text-[15px] text-muted">
                  <span>{hm(o.facts.departLocal)} → {hm(o.facts.arriveLocal)}{o.facts.durationMin ? ` · ${dur(o.facts.durationMin)}` : ""} · {o.facts.stops === 0 ? "non-stop" : `${o.facts.stops} stop${o.facts.stops > 1 ? "s" : ""}`}</span>
                  <span>{inr(o.perTravellerInr)} each</span>
                </span>
                <span className="mt-1 flex flex-wrap gap-1.5">
                  {o.id === part.cheapestId && <Badge tone="lime">Cheapest</Badge>}
                  {o.id === part.fastestId && <Badge tone="muted"><Zap size={11} className="mr-1 inline" />Fastest</Badge>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="rounded-xl border border-warn p-3 text-[15px]">No flights came back for that route and day. Try another date, or open a platform below and search there.</p>}
      <p className="text-[13px] text-muted">Reference fares from official price APIs ({chosen?.source ?? "see source"}). MakeMyTrip, Goibibo, Cleartrip and ixigo can show a different price for the same flight, so check it there before you pay.</p>

      <div className="space-y-2">
        <p className="text-[15px] font-semibold">Book it where you like, and pay there</p>
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="compare-platforms">
          {part.platforms.map((p) => (
            <li key={p.id}>
              <a href={p.searchUrl} target="_blank" rel="noopener noreferrer" data-testid="compare-open" className="flex min-h-12 items-center justify-between gap-2 rounded-xl border-[1.5px] border-line bg-surface px-3 text-[16px] font-semibold hover:border-muted">
                <span>{p.name}{p.connected ? <span className="ml-2 text-[13px] font-normal text-ok">logged in</span> : null}</span><ExternalLink size={16} />
              </a>
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-muted">Each link opens that platform&apos;s own page for this route and day. Log in on their site (we never see your password), find {chosen ? `${chosen.facts.flightNo} at about ${inr(chosen.totalInr)}` : "your flight"}, and pay there. Safar Saathi cannot book or take payment on them.</p>
      </div>

      {chosen && (
        <Button variant="primary" size="lg" block disabled={!online || recorded} data-testid="compare-record" onClick={() => { setRecorded(true); onRecord({ flightNo: chosen.facts.flightNo, carrierName: chosen.facts.carrier, departIso: chosen.facts.departLocal, arriveIso: chosen.facts.arriveLocal }, part); }}>
          {recorded ? "Booking form is below" : "I have paid: record my booking"}
        </Button>
      )}
    </section>
  );
}
