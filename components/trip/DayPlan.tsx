"use client";
import type { OfflinePack } from "@/lib/packs/types";
import { fmtDate } from "@/lib/time";

/** Day-by-day plan from the saved pack, with real photos of the real landmarks. Works offline (photos are cached per trip). */
export function DayPlan({ pack, today }: { pack: OfflinePack; today: string }) {
  const openIdx = Math.max(0, pack.days.findIndex((d) => d.date >= today));
  const used = new Map<string, NonNullable<OfflinePack["places"][string]["image"]>>();
  return (
    <section aria-labelledby="dayplan" data-testid="day-plan" className="space-y-2">
      <h2 id="dayplan" className="text-[20px] font-semibold">Day by day</h2>
      {pack.days.map((d, i) => (
        <details key={d.date} className="card p-4" open={i === openIdx}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3">
            <span><span className="mr-2 font-display font-bold text-accent">Day {d.dayNo}</span><span className="font-semibold">{d.title}</span></span>
            <span className="text-[14px] text-muted">{fmtDate(d.date)}</span>
          </summary>
          <ul className="mt-3 space-y-3 border-t border-line pt-3">
            {d.items.map((it, k) => {
              const p = it.placeId ? pack.places[it.placeId] : undefined;
              if (p?.image) used.set(p.image.src, p.image);
              return (
                <li key={k} className="flex items-start gap-3">
                  <span className="w-12 shrink-0 pt-0.5 font-mono text-[15px] text-muted">{it.time}</span>
                  {p?.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image.src} alt={p.name} loading="lazy" className="size-16 shrink-0 rounded-xl object-cover" data-testid="plan-photo" />
                  )}
                  <span className="min-w-0"><span className="block leading-snug">{it.title}</span>{it.notes && <span className="block text-[14px] text-muted">{it.notes}</span>}</span>
                </li>
              );
            })}
          </ul>
        </details>
      ))}
      {Object.values(pack.places).some((p) => p.image) && (
        <details className="px-1 text-[13px] text-muted" data-testid="plan-credits">
          <summary className="cursor-pointer">Photo credits</summary>
          <ul className="mt-1 space-y-0.5">
            {Object.values(pack.places).filter((p) => p.image).map((p) => (
              <li key={p.id}>{p.name}: {p.image!.title} by {p.image!.author}, {p.image!.license}, via Wikimedia Commons</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
