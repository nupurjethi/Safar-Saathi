import { notFound } from "next/navigation";
import Link from "next/link";
import { Check, Plane, Hotel, Car, Ticket } from "lucide-react";
import { HeroArt } from "@/components/ui/ItineraryCard";
import { PreviewMapLazy } from "@/components/map/PreviewMapLazy";
import { PlacePhoto } from "@/components/ui/PlacePhoto";
import { SelectTrip } from "@/components/trip/SelectTrip";
import { estimateOffline } from "@/lib/packs/estimate";
import { Badge, Card, SectionTitle, SampleTag } from "@/components/ui/primitives";
import { itineraryDetail } from "@/lib/server/catalogue";
import { fmtDate, fmtTimeZ, inr } from "@/lib/time";
import { ORIGINS } from "@/lib/seed/data";

export const dynamic = "force-dynamic";
type SP = Record<string, string | undefined>;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await itineraryDetail(slug).catch(() => null);
  return { title: d?.itinerary.title ?? "Itinerary" };
}

export default async function ItineraryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const pax = Math.min(Math.max(Number(sp.pax ?? 2) || 2, 1), 9);
  const d = await itineraryDetail(slug, sp.start, pax);
  if (!d) notFound();
  const it = d.itinerary;
  const pr = d.pricing;
  const origin = ORIGINS[it.originCity];
  const est = estimateOffline(d.cities.map((c) => c.slug));
  const hero = d.cities[0].hero;
  const poiByName = new Map(d.pois.map((p) => [p.name, p]));
  const visited = d.pois.filter((p) => d.days.some((x) => x.items.some((i) => i.place === p.name)));
  const credited = visited.filter((p) => p.image);
  const points = d.cities.flatMap((c) => [
    ...d.hotels.filter((h) => h.city === c.slug).map((h) => ({ name: h.name, lat: h.lat, lon: h.lon, kind: "hotel" as const, city: c.slug })),
    ...d.pois.filter((p) => p.city === c.slug && d.days.some((x) => x.items.some((i) => i.place === p.name))).map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, kind: "sight" as const, city: c.slug })).slice(0, 6),
  ]);
  return (
    <div className="space-y-6 pb-24">
      <div className="relative overflow-hidden rounded-3xl">
        {hero ? <PlacePhoto src={hero.src} alt={`${d.cities[0].name}: ${hero.credit.title}`} credit={hero.credit} className="h-60 sm:h-72" priority /> : <HeroArt palette={it.heroPalette} className="h-52 sm:h-64" />}
        <SampleTag className="absolute right-4 top-4" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black/80 to-transparent p-5 pb-8 text-white">
          <p className="text-[15px] capitalize">{it.theme} · {it.tier} · {it.nights} nights · from {origin.name}</p>
          <h1 className="text-[32px] font-bold leading-tight">{it.title}</h1>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <p className="text-[18px]">{it.summary}</p>
          <section aria-labelledby="days">
            <SectionTitle>Day by day</SectionTitle>
            <div className="space-y-2" id="days">
              {d.days.map((day) => (
                <details key={day.dayNo} className="card group p-4" open={day.dayNo === 1}>
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3"><span><span className="mr-2 font-display font-bold text-accent">Day {day.dayNo}</span><span className="font-semibold">{day.title}</span></span><span className="text-muted transition group-open:rotate-180">⌄</span></summary>
                  <ul className="mt-3 space-y-2 border-t border-line pt-3">
                    {day.items.map((i, k) => { const p = i.place ? poiByName.get(i.place) : undefined; return <li key={k} className="flex items-start gap-3"><span className="w-12 shrink-0 pt-0.5 font-mono text-[15px] text-muted">{i.time}</span>{p?.image && <PlacePhoto src={p.image.src} alt={p.name} credit={p.image.credit} showCredit={false} className="size-14 shrink-0 rounded-xl" />}<span className="min-w-0">{i.title}{i.notes && <span className="block text-[15px] text-muted">{i.notes}</span>}</span></li>; })}
                  </ul>
                </details>
              ))}
            </div>
          </section>
          <section>
            <SectionTitle>What is included</SectionTitle>
            <ul className="grid gap-2 sm:grid-cols-2">
              {[[<Plane key="p" size={20} />, "Return flights (sample fares)"], [<Hotel key="h" size={20} />, `${it.tier === "budget" ? 3 : it.tier === "standard" ? 4 : 5}-star stays (sample hotels)`], [<Car key="c" size={20} />, "Airport pickup and drop"], [<Ticket key="t" size={20} />, "Activities in the day plan"], [<Check key="o" size={20} />, "Offline guide, map and SOS after you book"], [<Check key="a" size={20} />, "AI agent for changes, with your Confirm tap"]].map(([ic, t], i) => <li key={i} className="card flex items-center gap-3 p-3"><span className="text-accent">{ic as React.ReactNode}</span>{t as string}</li>)}
            </ul>
          </section>
          {visited.length > 0 && (
            <section aria-labelledby="places">
              <SectionTitle>Real places on this trip</SectionTitle>
              <ul id="places" className="grid grid-cols-2 gap-3" data-testid="places">
                {visited.map((p) => (
                  <li key={p.id} className="card overflow-hidden">
                    {p.image ? <PlacePhoto src={p.image.src} alt={p.name} credit={p.image.credit} className="h-28 sm:h-40" /> : <div className="grid h-28 place-items-center bg-surface-2 px-2 text-center text-[13px] text-muted sm:h-24">No openly licensed photo found</div>}
                    <div className="space-y-0.5 p-2.5 sm:p-3">
                      <p className="text-[15px] font-semibold leading-snug sm:text-[17px]">{p.name}</p>
                      {p.nameLocal && p.nameLocal !== p.name && <p className="text-[15px] text-muted" lang="und">{p.nameLocal}</p>}
                      <a href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=17/${p.lat}/${p.lon}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-mono text-[13px] text-accent underline"><span className="sm:hidden">Open on map</span><span className="hidden sm:inline">{p.lat.toFixed(4)}, {p.lon.toFixed(4)} · open on OpenStreetMap</span></a>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[13px] text-muted">Landmarks and coordinates are real. Hotels, flights, prices and transfers on this page are fictional sample data.</p>
            </section>
          )}
          <section><SectionTitle>Map preview</SectionTitle><PreviewMapLazy cities={d.mapCities} points={points} label={d.cities.map((c) => c.name).join(" and ")} /></section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card className="space-y-3">
            <h2 className="text-[20px] font-semibold">Price</h2>
            <form className="grid grid-cols-2 gap-2" action={`/itinerary/${slug}`}>
              <label className="text-[14px] text-muted">Arrive<input type="date" name="start" defaultValue={pr?.startDate} className="mt-1 min-h-11 w-full rounded-xl border-[1.5px] border-line bg-surface-2 px-2 text-[16px] text-ink" /></label>
              <label className="text-[14px] text-muted">Travellers<input type="number" name="pax" min={1} max={9} defaultValue={pax} className="mt-1 min-h-11 w-full rounded-xl border-[1.5px] border-line bg-surface-2 px-2 text-[16px] text-ink" /></label>
              <button className="col-span-2 min-h-11 rounded-xl border-[1.5px] border-line text-[15px] font-semibold hover:border-muted">Update price</button>
            </form>
            {pr ? (
              <>
                <dl className="space-y-1.5 text-[16px]" data-testid="price-breakdown">
                  {pr.breakdown.map((b) => <div key={b.label} className="flex justify-between"><dt className="text-muted">{b.label}</dt><dd>{inr(b.amountInr)}</dd></div>)}
                  <div className="flex justify-between border-t border-line pt-2 text-[20px] font-bold"><dt>Total, {pax} travellers</dt><dd className="font-display">{inr(pr.totalInr)}</dd></div>
                </dl>
                <p className="text-[14px] text-muted">{fmtDate(pr.startDate)} to {fmtDate(pr.endDate)}. Sample prices. Test payment, no money moves.</p>
                <p className="rounded-xl border border-line p-3 text-[14px]" data-testid="offline-estimate"><b>Offline guide:</b> about {est.mb} MB, takes about {est.seconds} seconds on 4G{est.fromBuiltTiles ? "" : " (estimate)"}. Saved on your phone when you select this trip, before you pay.</p>
                {pr.flights.slice(0, 1).map((f, i) => <p key={i} className="text-[14px] text-muted">Outbound sample flight: {String(f.carrierName)} {String(f.flightNo)}, {fmtTimeZ(String(f.departAt), origin.tz)}</p>)}
                {pr.warnings.length > 0 && <Badge tone="warn">{pr.warnings[0]}</Badge>}
              </>
            ) : <p className="text-warn">Prices are not available for that date.</p>}
          </Card>
        </aside>
      </div>

      <div className="no-print fixed inset-x-0 bottom-[5.25rem] z-30 border-t border-line bg-bg/95 p-3 backdrop-blur sm:bottom-0">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div><p className="text-[13px] text-muted">{pax} travellers · from</p><p className="font-display text-[24px] font-bold">{pr ? inr(pr.totalInr) : inr(it.pricePerPersonInr)}</p></div>
          <SelectTrip slug={slug} startDate={pr?.startDate ?? ""} pax={pax} />
        </div>
      </div>
      {(hero || credited.length > 0) && (
        <details className="card p-4 text-[13px] text-muted" data-testid="photo-credits">
          <summary className="cursor-pointer font-semibold text-ink">Photo credits</summary>
          <ul className="mt-2 space-y-1">
            {[...(hero ? [{ name: d.cities[0].name, c: hero.credit }] : []), ...credited.map((p) => ({ name: p.name, c: p.image!.credit }))].filter((x, i, a) => a.findIndex((y) => y.c.sourceUrl === x.c.sourceUrl) === i).map((x) => (
              <li key={x.c.sourceUrl}>{x.name}: <a className="text-accent underline" href={x.c.sourceUrl} target="_blank" rel="noopener noreferrer">{x.c.title}</a> by {x.c.author}, <a className="underline" href={x.c.licenseUrl || x.c.sourceUrl} target="_blank" rel="noopener noreferrer">{x.c.license}</a>, via Wikimedia Commons</li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-[14px] text-muted">All itineraries, flights, hotels and prices are sample data from our own mock travel API. <Link href="/explore" className="text-accent underline">Back to all trips</Link></p>
    </div>
  );
}
