"use client";
import { ArrowRight, Check, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, LinkButton } from "@/components/ui/primitives";
import { inr } from "@/lib/time";

export type Line = { label: string; value: string };
export type Card = { title: string; lines: Line[] };
export type Review = {
  quoteId: string; bookingRef: string; kind: string; title: string; before: Card; after: Card; priceDeltaInr: number; rules: string[];
  expiresAt: string; blocked: boolean; blockedReason?: string; notice: string; chaos?: string | null;
  breakup: Line2[]; totalInr: number; source: string; validUntil: string; refundable: boolean;
};
export type Line2 = { label: string; amountInr: number };
export type ReviewState = "idle" | "confirming" | "applied" | "declined" | "repriced" | "expired" | "error";

export function ReviewCardView({ card, state, error, onConfirm, onDecline }: { card: Review; state: ReviewState; error?: string; onConfirm: () => void; onDecline: () => void }) {
  const [left, setLeft] = useState(() => new Date(card.expiresAt).getTime() - Date.now());
  useEffect(() => {
    const t = setInterval(() => setLeft(new Date(card.expiresAt).getTime() - Date.now()), 1000);
    return () => clearInterval(t);
  }, [card.expiresAt]);
  const expired = left <= 0 && state === "idle";
  const done = state !== "idle" && state !== "confirming" && state !== "error";
  return (
    <section aria-label="Review this change" data-testid="review-card" data-quote={card.quoteId} data-state={state} className="card-2 space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[20px] font-semibold">{card.title}</h3>
        <Badge tone={state === "applied" ? "ok" : state === "declined" || state === "repriced" ? "muted" : "warn"}>
          {state === "applied" ? "Confirmed" : state === "declined" ? "Declined" : state === "repriced" ? "Price moved" : expired || state === "expired" ? "Expired" : "Needs your tap"}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
        <Side card={card.before} muted />
        <ArrowRight className="hidden self-center text-accent sm:block" aria-hidden />
        <Side card={card.after} />
      </div>

      <div className="rounded-xl border-[1.5px] border-line bg-surface p-3" data-testid="breakup">
        <p className="mb-2 text-[14px] font-semibold text-muted">Price breakup</p>
        <ul className="space-y-1 text-[15px]">
          {card.breakup.map((l) => <li key={l.label} className="flex justify-between gap-3" data-testid="breakup-line"><span className="text-muted">{l.label}</span><span className="font-medium">{inr(l.amountInr)}</span></li>)}
        </ul>
        <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
          <span className="font-semibold">{card.kind === "flight_external" || card.kind === "hotel_external" ? "Total you paid on the platform" : "Total to pay"}</span>
          <span className="font-display text-[28px] font-bold" data-testid="price-delta">{inr(card.totalInr)}</span>
        </div>
        <p className="mt-1 text-[13px] text-muted" data-testid="offer-source">{card.source} · valid until {new Date(card.validUntil).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} · {card.refundable ? "Refundable" : "Not refundable"}</p>
      </div>

      <ul className="space-y-1 text-[15px] text-muted">{card.rules.map((r) => <li key={r}>• {r}</li>)}</ul>

      {card.blocked ? (
        <div className="space-y-2 rounded-xl border-[1.5px] border-danger p-3">
          <p className="flex items-center gap-2 font-semibold text-danger"><ShieldAlert size={18} /> {card.blockedReason}</p>
          <p className="text-[15px]">An agent from our team will handle this. You can also open SOS.</p>
          <LinkButton href={`/trips/${card.bookingRef}/sos`} size="md">Talk to a person</LinkButton>
        </div>
      ) : (
        <>
          <p className="text-[15px] font-semibold" data-testid="review-notice">{card.notice}</p>
          {error && <p role="alert" className="text-danger">{error}</p>}
          {!done && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="primary" size="lg" block disabled={state === "confirming" || expired} onClick={onConfirm} data-testid="confirm-btn">
                {state === "confirming" ? "Confirming…" : "Yes, confirm"}
              </Button>
              <Button variant="secondary" size="lg" block disabled={state === "confirming"} onClick={onDecline} data-testid="decline-btn">No</Button>
            </div>
          )}
          {state === "idle" && <p className="text-[13px] text-muted">{expired ? "This quote expired. Ask me again for a new one." : `Quote valid for ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}. There is no auto-confirm.`}</p>}
          {state === "applied" && <p className="pulse-once inline-flex items-center gap-2 rounded-full border border-ok px-3 py-1 text-ok"><Check size={16} /> Confirmed by you</p>}
        </>
      )}
    </section>
  );
}

function Side({ card, muted }: { card: Card; muted?: boolean }) {
  return (
    <div className={`rounded-xl border-[1.5px] p-3 ${muted ? "border-line bg-surface" : "border-lime bg-surface"}`}>
      <p className={`mb-2 text-[14px] font-semibold ${muted ? "text-muted" : "text-accent"}`}>{card.title}</p>
      <dl className="space-y-1 text-[15px]">
        {card.lines.map((l) => (
          <div key={l.label} className="flex justify-between gap-3"><dt className="text-muted">{l.label}</dt><dd className="text-right font-medium">{l.value}</dd></div>
        ))}
      </dl>
    </div>
  );
}
