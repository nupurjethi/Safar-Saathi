import Link from "next/link";
import { Search } from "lucide-react";
import { ItineraryCard } from "@/components/ui/ItineraryCard";
import { RoleLogin } from "@/components/ui/RoleLogin";
import { HowItWorks } from "@/components/ui/HowItWorks";
import { Chip, EmptyState } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/primitives";
import { searchItineraries, defaultStart } from "@/lib/server/catalogue";
import { addDays, inr } from "@/lib/time";
import { ORIGINS } from "@/lib/seed/data";

type SP = Record<string, string | undefined>;

const THEMES = ["beach", "culture", "adventure", "family", "honeymoon"];
const TIERS = ["budget", "standard", "premium"];
const NIGHTS = [3, 4, 5, 6, 7, 8];
const BUDGETS = [60000, 90000, 120000, 160000, 220000];

function monthOptions() {
  const out: { v: string; label: string }[] = [];
  const d = new Date();
  for (let i = 0; i < 5; i++) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1));
    out.push({ v: m.toISOString().slice(0, 7), label: m.toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) });
  }
  return out;
}
function startFor(month?: string) {
  if (!month) return defaultStart();
  const earliest = addDays(new Date().toISOString().slice(0, 10), 5);
  const latest = addDays(new Date().toISOString().slice(0, 10), 115);
  const want = `${month}-12`;
  return want < earliest ? earliest : want > latest ? latest : want;
}

export async function ExploreView({ searchParams, home = false }: { searchParams: Promise<SP>; home?: boolean }) {
  const sp = await searchParams;
  const q = {
    q: sp.q || undefined, theme: sp.theme, tier: sp.tier, nights: sp.nights ? Number(sp.nights) : undefined,
    budget: sp.budget ? Number(sp.budget) : undefined, from: sp.from || undefined, sort: sp.sort, page: sp.page ? Number(sp.page) : 1, pageSize: 12,
  };
  const res = await searchItineraries(q);
  const pax = Math.min(Math.max(Number(sp.pax ?? 2) || 2, 1), 9);
  const start = startFor(sp.month);
  const link = (patch: SP) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch, page: undefined })) if (v) p.set(k, v);
    return `${home ? "/" : "/explore"}?${p.toString()}`;
  };
  const toggle = (k: string, v: string) => link({ [k]: sp[k] === v ? undefined : v });
  const lastPage = Math.ceil(res.total / res.pageSize);

  return (
    <div className="space-y-6">
      {home && <RoleLogin />}
      {home ? (
        <section className="space-y-5 pt-2" aria-label="Welcome">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[13px] font-semibold text-muted"><span className="size-1.5 rounded-full bg-lime" /> New: your offline guide is ready before you pay</span>
          <h1 className="max-w-3xl text-[clamp(38px,6vw,68px)] font-semibold leading-[1.02] tracking-[-0.04em]">Pick a trip. <span className="text-accent">Your guide works offline</span> from the first tap.</h1>
          <p className="max-w-2xl text-[18px] text-muted">{res.total} sample itineraries. Select one and we save its plan, map, contacts and help guides on your phone. Pay when you are ready. Changes only happen when you confirm.</p>
          <div className="flex flex-wrap gap-3"><LinkButton href="#results" variant="primary">Browse {res.total} trips</LinkButton><LinkButton href="/api/auth/demo?next=/trips" prefetch={false}>Demo: open Neha&apos;s trip</LinkButton><LinkButton href="/api/auth/demo?next=/trips/SS-56001" prefetch={false} data-testid="demo-bangalore">Demo: Bangalore trip (GPS)</LinkButton><LinkButton href="/story" variant="ghost">How it works</LinkButton></div>
        </section>
      ) : (
        <div className="space-y-2">
          <h1 className="text-[32px] font-bold leading-tight">Find your trip</h1>
          <p className="text-muted">{res.total} sample itineraries. Select one and its offline guide is saved on your phone.</p>
        </div>
      )}

      {home && <HowItWorks />}

      <form action={home ? "/" : "/explore"} className="card grid grid-cols-2 gap-3 p-4 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]" role="search">
        <label className="col-span-2 space-y-1 text-[15px] text-muted sm:col-span-1">Destination<input name="q" defaultValue={sp.q} placeholder="Paris, Bali, Dubai…" className="mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-line bg-surface-2 px-3 text-[17px] text-ink placeholder:text-muted" /></label>
        <label className="space-y-1 text-[15px] text-muted">Month<select name="month" defaultValue={sp.month ?? ""} className="mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-line bg-surface-2 px-3 text-[17px] text-ink"><option value="">Any month</option>{monthOptions().map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}</select></label>
        <label className="space-y-1 text-[15px] text-muted">Budget per person<select name="budget" defaultValue={sp.budget ?? ""} className="mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-line bg-surface-2 px-3 text-[17px] text-ink"><option value="">Any</option>{BUDGETS.map((b) => <option key={b} value={b}>Up to {inr(b)}</option>)}</select></label>
        <label className="space-y-1 text-[15px] text-muted">Flying from<select name="from" defaultValue={sp.from ?? ""} className="mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-line bg-surface-2 px-3 text-[17px] text-ink"><option value="">Any city</option>{Object.entries(ORIGINS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}</select></label>
        <label className="space-y-1 text-[15px] text-muted">Travellers<input name="pax" type="number" min={1} max={9} defaultValue={pax} className="mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-line bg-surface-2 px-3 text-[17px] text-ink" /></label>
        <button className="col-span-2 inline-flex min-h-12 items-center justify-center gap-2 self-end rounded-xl sm:col-span-1 bg-lime px-5 font-semibold text-lime-ink glow"><Search size={18} /> Search</button>
      </form>

      <div className="space-y-2" aria-label="Filters">
        {/* phones: one scrollable row per filter group (no 4-line wall of chips); wider screens wrap */}
        {[
          { label: "Theme", key: "theme", opts: THEMES.map((v) => ({ v, n: res.facets.theme[v] ?? 0, cap: true })) },
          { label: "Tier", key: "tier", opts: TIERS.map((v) => ({ v, n: res.facets.tier[v] ?? 0, cap: true })) },
          { label: "Nights", key: "nights", opts: NIGHTS.map((n) => ({ v: String(n), n: res.facets.nights[n] ?? 0, cap: false })) },
        ].map((g) => (
          <div key={g.key} className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label={g.label}>
            <span className="w-14 shrink-0 text-[15px] text-muted">{g.label}</span>
            {g.opts.map((o) => <Link key={o.v} href={toggle(g.key, o.v)} aria-pressed={sp[g.key] === o.v} className="shrink-0"><Chip active={sp[g.key] === o.v} className={o.cap ? "capitalize" : ""}>{o.v} <span className="opacity-70">{o.n}</span></Chip></Link>)}
          </div>
        ))}
        {Object.keys(sp).some((k) => k !== "pax" && sp[k]) && <Link href={home ? "/" : "/explore"} className="inline-flex min-h-11 items-center text-[15px] text-accent underline">Clear all filters</Link>}
      </div>

      {res.items.length === 0 ? (
        <EmptyState title="No trips match" body="Try a wider budget, another theme, or clear the filters." action={<Link href={home ? "/" : "/explore"} className="inline-flex min-h-12 items-center rounded-full bg-lime px-6 font-semibold text-lime-ink">Clear filters</Link>} />
      ) : (
        <ul id="results" className="grid scroll-mt-24 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="results">
          {res.items.map((it) => (
            <li key={it.slug}><ItineraryCard it={it as never} href={`/itinerary/${it.slug}?start=${start}&pax=${pax}`} /></li>
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-center gap-3">
          {res.page > 1 && <Link href={`${link({})}&page=${res.page - 1}`} className="inline-flex min-h-11 items-center rounded-xl border-[1.5px] border-line px-4">Previous</Link>}
          <span className="text-muted">Page {res.page} of {lastPage}</span>
          {res.page < lastPage && <Link href={`${link({})}&page=${res.page + 1}`} className="inline-flex min-h-11 items-center rounded-xl border-[1.5px] border-line px-4">Next</Link>}
        </nav>
      )}
    </div>
  );
}
