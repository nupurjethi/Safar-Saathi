"use client";
import { Check } from "lucide-react";
import { useState } from "react";
import { broadcastPlatform, useSelectedPlatform } from "./platform-choice";

const OPTIONS = [
  { id: "makemytrip", name: "MakeMyTrip" },
  { id: "goibibo", name: "Goibibo" },
  { id: "cleartrip", name: "Cleartrip" },
  { id: "ixigo", name: "ixigo" },
] as const;

/**
 * "I'm logged in to": the traveller picks the booking platform they use. Price cards then show "Pay on <platform>" and open
 * that site, where the traveller logs in and pays. Self-declared: Safar Saathi never sees their account or password.
 */
export function PlatformSelector({ bookingRef }: { bookingRef: string }) {
  const selected = useSelectedPlatform();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const choose = async (id: string) => {
    if (busy || id === selected) return;
    setBusy(true); setErr(null);
    broadcastPlatform(id);
    try {
      const results = await Promise.all(OPTIONS.map((o) => fetch("/api/providers/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: o.id, connected: o.id === id }) })));
      if (results.some((r) => !r.ok)) setErr("Could not save your choice. It applies on this page only.");
    } catch { setErr("No connection. Your choice applies on this page only."); }
    setBusy(false);
  };

  return (
    <section aria-label="Booking platform you are logged in to" data-testid="platform-selector" data-booking={bookingRef} className="space-y-1.5 rounded-2xl border-[1.5px] border-line bg-surface p-3">
      <p className="text-[14px] font-semibold">I&apos;m logged in to</p>
      <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {OPTIONS.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={selected === o.id} disabled={busy} onClick={() => void choose(o.id)} data-testid={`platform-choice-${o.id}`}
            className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border-[1.5px] px-3 text-[15px] font-semibold ${selected === o.id ? "border-lime bg-lime text-lime-ink" : "border-line bg-surface-2 text-ink hover:border-muted"}`}>
            {selected === o.id && <Check size={16} />}{o.name}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-muted">{err ?? "Prices in the chat are sample prices. \"Pay on\" opens your platform; you log in and pay there. We never see your password."}</p>
    </section>
  );
}
