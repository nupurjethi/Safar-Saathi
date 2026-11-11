import Link from "next/link";
import { Star } from "lucide-react";
import { SampleTag } from "./primitives";
import { PlacePhoto } from "./PlacePhoto";
import type { ImageCredit } from "@/lib/db/schema";
import { inr } from "@/lib/time";

export type CardItin = { slug: string; title: string; nights: number; cityNames: string[]; pricePerPersonInr: number; ratingSample: number; heroPalette: [string, string]; theme: string; tier: string; originCity: string; hero?: { src: string; credit: ImageCredit } | null };

/** Duotone gradient art from hero_palette. Abstract route lines and pins only, no stock photos. */
export function HeroArt({ palette, className = "" }: { palette: [string, string]; className?: string }) {
  return (
    <div aria-hidden className={`relative overflow-hidden ${className}`} style={{ background: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})` }}>
      <div className="absolute inset-0 bg-black/35" />
      <svg viewBox="0 0 400 200" className="absolute inset-0 size-full" preserveAspectRatio="none">
        <path d="M-10 150 C 80 60, 140 190, 210 110 S 330 40, 420 90" fill="none" stroke="#d8fd34" strokeWidth="3" strokeDasharray="2 10" strokeLinecap="round" opacity="0.9" />
        <circle cx="86" cy="104" r="7" fill="#d8fd34" /><circle cx="86" cy="104" r="3" fill="#050505" />
        <circle cx="332" cy="62" r="7" fill="#d8fd34" /><circle cx="332" cy="62" r="3" fill="#050505" />
      </svg>
    </div>
  );
}

export function ItineraryCard({ it, href }: { it: CardItin; href: string }) {
  return (
    <Link href={href} className="card group block overflow-hidden transition hover:border-muted" data-testid="itinerary-card">
      <div className="relative">
        {it.hero ? (
          <div className="relative h-44">
            <PlacePhoto src={it.hero.src} alt={`${it.cityNames[0]}: ${it.hero.credit.title}`} credit={it.hero.credit} className="h-full" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
          </div>
        ) : <HeroArt palette={it.heroPalette} className="h-36" />}
        <SampleTag className="absolute right-3 top-3" />
        <span className="absolute bottom-7 left-3 rounded-full bg-black/60 px-2.5 py-0.5 text-[13px] font-semibold text-white">{it.nights} nights · {it.cityNames.join(" → ")}</span>
      </div>
      <div className="space-y-1.5 p-4">
        <h3 className="text-[20px] font-semibold leading-snug group-hover:text-accent">{it.title}</h3>
        <p className="text-[15px] capitalize text-muted">{it.theme} · {it.tier} · from {it.originCity}</p>
        <div className="flex items-end justify-between pt-1">
          <p><span className="font-display text-[24px] font-bold">{inr(it.pricePerPersonInr)}</span><span className="text-[15px] text-muted"> per person</span></p>
          <span className="inline-flex items-center gap-1 text-[15px] text-muted"><Star size={16} className="fill-current text-warn" /> {it.ratingSample.toFixed(1)}</span>
        </div>
      </div>
    </Link>
  );
}
