"use client";
import type { OfflinePack } from "@/lib/packs/types";
import { currentStay } from "@/lib/rules/context";
import { creditLine } from "@/components/ui/PlacePhoto";

type Img = NonNullable<OfflinePack["places"][string]["image"]>;

/** Landmark photos for a trip, in plan order (first mention wins). All files are in the offline pack, so this works in airplane mode. */
export function tripPhotos(pack: OfflinePack): { name: string; city: string; image: Img }[] {
  const out: { name: string; city: string; image: Img }[] = [];
  const seen = new Set<string>();
  const add = (id?: string) => { const p = id ? pack.places[id] : undefined; if (p?.image && !seen.has(p.id)) { seen.add(p.id); out.push({ name: p.name, city: p.city, image: p.image }); } };
  for (const d of pack.days) for (const it of d.items) add(it.placeId);
  for (const p of Object.values(pack.places)) if (p.kind === "poi") add(p.id); // landmarks of the destination that are not on a plan line
  return out;
}

const Credit = ({ c }: { c: Img }) => (
  <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" title={`${c.title}: ${c.author}, ${c.license}. Wikimedia Commons`} className="absolute bottom-1.5 right-1.5 max-w-[90%] truncate rounded-full bg-black/65 px-2 py-0.5 text-[10px] leading-tight text-white/85 hover:text-white">{creditLine(c)}</a>
);

/** Photo banner of where the traveller is going, plus a strip of the real places on the plan. */
export function TripHero({ pack, now }: { pack: OfflinePack; now: Date }) {
  const stay = currentStay(pack, now);
  const photos = tripPhotos(pack);
  const here = photos.filter((p) => p.city === stay.city);
  const hero = (here[0] ?? photos[0])?.image;
  const cities = [...new Set(pack.days.map((d) => d.cityName))];
  if (!hero) return null;
  return (
    <section aria-label="Where you are going" data-testid="trip-hero" className="space-y-3">
      <div className="relative h-52 overflow-hidden rounded-3xl bg-surface-2 sm:h-64">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={hero.src} alt={`${stay.cityName}: ${hero.title}`} className="absolute inset-0 size-full object-cover" data-testid="trip-hero-photo" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pb-7 text-white">
          <p className="text-[14px] opacity-90">{cities.join(" → ")}</p>
          <p className="text-[24px] font-bold leading-tight">{stay.cityName}</p>
        </div>
        <Credit c={hero} />
      </div>
      {photos.length > 1 && (
        <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" aria-label="Places on your trip">
          <ul className="flex gap-3" data-testid="trip-places">
            {photos.map((p) => (
              <li key={p.image.src} className="relative h-28 w-44 shrink-0 overflow-hidden rounded-2xl bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.image.src} alt={p.name} loading="lazy" className="absolute inset-0 size-full object-cover" />
                <span className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-2 pb-4 pt-1.5 text-[13px] font-semibold leading-tight text-white">{p.name.replace(/ \(.*\)$/, "")}</span>
                <Credit c={p.image} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
