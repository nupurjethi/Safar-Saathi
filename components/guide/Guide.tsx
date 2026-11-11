"use client";
import { ArrowLeft, Car, CloudOff, Copy, HeartPulse, Hotel, IdCard, LifeBuoy, MapPin, Phone, Plane, Route, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { TripGate } from "@/components/trip/TripGate";
import { useTrip } from "@/components/trip/TripProvider";
import { Badge, Button, Card, LinkButton, Skeleton } from "@/components/ui/primitives";
import { buildContext, currentStay } from "@/lib/rules/context";
import { resolve, walk, type Scenario } from "@/lib/rules/engine";
import { SCENARIO_ORDER } from "@/lib/rules/scenarios";
import { telHref } from "@/lib/trip/derive";
import type { OfflinePack } from "@/lib/packs/types";

const ICONS: Record<string, React.ReactNode> = {
  plane: <Plane size={26} strokeWidth={1.75} />, route: <Route size={26} strokeWidth={1.75} />, hotel: <Hotel size={26} strokeWidth={1.75} />,
  car: <Car size={26} strokeWidth={1.75} />, passport: <IdCard size={26} strokeWidth={1.75} />, "heart-pulse": <HeartPulse size={26} strokeWidth={1.75} />,
};

function Inner() {
  const t = useTrip();
  const sp = useSearchParams();
  const sid = sp.get("s");
  return <TripGate>{(pack) => <GuideBody pack={pack} sid={sid} go={(s) => window.history.pushState(null, "", `/trips/${t.ref}/guide${s ? `?s=${s}` : ""}`)} />}</TripGate>;
}
export function Guide() {
  return <Suspense fallback={<Skeleton className="h-64" />}><Inner /></Suspense>;
}

function GuideBody({ pack, sid, go }: { pack: OfflinePack; sid: string | null; go: (s: string | null) => void }) {
  const t = useTrip();
  const [city, setCity] = useState<string | undefined>(undefined);
  const [addr, setAddr] = useState<string | null>(null);
  const ctx = useMemo(() => buildContext(pack, t.now, city), [pack, t.now, city]);
  const stay = currentStay(pack, t.now, city);
  const offline = t.net !== "online";
  const scenarios = SCENARIO_ORDER.map((id) => pack.rules[id]).filter(Boolean);
  const opened = useRef(0);
  useEffect(() => { opened.current = performance.now(); }, [sid]);

  return (
    <div className="space-y-4">
      {offline && (
        <div role="status" data-testid="offline-banner" className="flex items-center gap-3 rounded-2xl border-[1.5px] border-warn p-3">
          <CloudOff className="shrink-0 text-warn" />
          <p className="font-semibold">Airplane mode / No network. Everything on this page works without data.</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] text-muted">I am in</span>
        {pack.stays.map((s) => (
          <button key={s.city} onClick={() => setCity(s.city)} aria-pressed={stay.city === s.city} className={`min-h-11 rounded-full border-[1.5px] px-4 text-[15px] font-semibold ${stay.city === s.city ? "border-lime bg-lime text-lime-ink" : "border-line bg-surface"}`}>{s.cityName}</button>
        ))}
      </div>

      {!sid ? (
        <>
          <h1 className="text-[32px] font-bold leading-tight">What is going wrong?</h1>
          <ul className="grid gap-3 sm:grid-cols-2" data-testid="scenario-grid">
            {scenarios.map((s) => (
              <li key={s.id}>
                <button onClick={() => go(s.id)} data-testid={`scenario-${s.id}`} className="card flex min-h-24 w-full items-center gap-4 p-4 text-left transition hover:border-muted">
                  <span className={`grid size-12 shrink-0 place-items-center rounded-xl border-[1.5px] ${s.severity === 1 ? "border-danger text-danger" : "border-line text-accent"}`}>{ICONS[s.icon]}</span>
                  <span className="min-w-0"><span className="block text-[20px] font-semibold leading-tight">{s.title}</span><span className="block text-[15px] text-muted">{resolve(s, ctx).when}</span></span>
                  {s.severity === 1 && <Badge tone="danger" className="ml-auto">Urgent</Badge>}
                </button>
              </li>
            ))}
          </ul>
          <Card className="space-y-1 text-[15px] text-muted"><p data-testid="guide-label"><Badge tone={pack.rulesMeta.origin === "template" ? "muted" : "ok"}>{pack.rulesMeta.label}</Badge></p><p>{pack.disclaimer}</p><p>Saved on this phone: version {t.stored?.version}. Contact numbers in this prototype are sample numbers.</p></Card>
        </>
      ) : (
        <ScenarioView sc={pack.rules[sid]} ctx={ctx} pack={pack} refCode={t.ref} stayHotel={stay.hotelId} stayAirport={stay.airportId} onBack={() => go(null)} onAddr={setAddr} opened={opened} />
      )}

      {addr && <AddressCard text={addr} onClose={() => setAddr(null)} />}
    </div>
  );
}

function ScenarioView({ sc, ctx, pack, refCode, stayHotel, stayAirport, onBack, onAddr, opened }: { sc: Scenario | undefined; ctx: Record<string, unknown>; pack: OfflinePack; refCode: string; stayHotel: string; stayAirport: string; onBack: () => void; onAddr: (s: string) => void; opened: { current: number } }) {
  const [answers, setAnswers] = useState<string[]>([]);
  const missing: string[] = [];
  const resolved = useMemo(() => (sc ? resolve(sc, ctx, (p) => missing.push(p)) : null), [sc, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = useTrip();
  useEffect(() => {
    // success metric: an offline answer appears in under 1 s
    const ms = Math.round(performance.now() - opened.current);
    if (sc && t.net === "online") void fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "offline_answer", props: { ms, scenario: sc.id } }) }).catch(() => {});
  }, [sc?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sc || !resolved) return <Card>That scenario is not in your guide. <button className="text-accent underline" onClick={onBack}>Back</button></Card>;
  const { steps, ask } = walk(resolved, answers);
  // most useful first: address, then phone number, then the steps (UX principle)
  const shows = [...new Set(steps.map((s) => s.show).filter(Boolean) as string[])];
  const calls = [...new Map(steps.filter((s) => s.call).map((s) => [s.call!, s.callLabel ?? "Call"])).entries()];
  const mapStep = steps.some((s) => s.map === "hotel");

  return (
    <div className="space-y-4" data-testid="scenario-detail" data-scenario={sc.id}>
      <button onClick={onBack} className="inline-flex min-h-11 items-center gap-1 text-accent"><ArrowLeft size={18} /> All problems</button>
      <div className="space-y-1"><h1 className="text-[32px] font-bold leading-tight">{sc.title}</h1><p className="text-muted">{resolved.when}</p></div>

      {shows.map((s) => (
        <button key={s} onClick={() => onAddr(s)} data-testid="address-card-open" className="card w-full border-lime p-4 text-left">
          <span className="text-[13px] font-semibold uppercase tracking-wide text-accent">Show this to a driver · tap for full screen</span>
          <span className="mt-1 block text-[24px] font-semibold leading-snug">{s}</span>
        </button>
      ))}
      <div className="grid gap-2 sm:grid-cols-2">
        {calls.map(([c, label]) => (
          <LinkButton key={c} href={telHref(c)} size="xl" className="justify-start"><Phone size={22} /> <span className="text-[15px] font-normal text-muted">{label}</span> <span className="font-mono">{c}</span></LinkButton>
        ))}
        {mapStep && <LinkButton href={`/trips/${refCode}/map?route=${encodeURIComponent(`${stayAirport}__${stayHotel}`)}&pin=${stayHotel}`} size="xl" className="justify-start"><MapPin size={22} /> Open map route</LinkButton>}
      </div>

      <ol className="space-y-3" data-testid="steps">
        {steps.map((s, i) => (
          <li key={i} className="card flex gap-3 p-4"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-lime font-display font-bold text-lime-ink">{i + 1}</span><p className="text-[18px] leading-snug">{s.text}</p></li>
        ))}
      </ol>

      {ask && (
        <Card className="space-y-3">
          <p className="text-[20px] font-semibold">{ask.question}</p>
          <div className="grid gap-2">{ask.options.map((o) => <Button key={o.branch} size="lg" block onClick={() => setAnswers((a) => [...a, o.branch])}>{o.label}</Button>)}</div>
        </Card>
      )}
      {answers.length > 0 && <button className="text-accent underline" onClick={() => setAnswers([])}>Start over</button>}

      <div className="space-y-2 border-t border-line pt-4">
        <LinkButton href={`/trips/${refCode}/sos`} variant="danger" size="xl" block><LifeBuoy size={24} /> Still stuck? SOS</LinkButton>
        <p className="text-[14px] text-muted">{pack.disclaimer}</p>
        {missing.length > 0 && <p className="text-[13px] text-warn">Some details are not in your booking: {[...new Set(missing)].join(", ")}.</p>}
      </div>
    </div>
  );
}

function AddressCard({ text, onClose }: { text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="dialog" aria-modal="true" aria-label="Address card" className="fixed inset-0 z-50 flex flex-col bg-white p-6 text-black" data-testid="address-card">
      <div className="flex items-center justify-between"><p className="text-[18px] font-semibold">Please take me to:</p><button onClick={onClose} aria-label="Close" className="grid size-14 place-items-center rounded-xl border-2 border-black"><X size={28} /></button></div>
      <p className="my-auto text-center text-[clamp(32px,9vw,64px)] font-bold leading-tight">{text}</p>
      <div className="flex gap-3"><Button className="flex-1 border-2 border-black bg-white text-black" size="xl" onClick={() => { void navigator.clipboard?.writeText(text); setCopied(true); }}><Copy size={22} /> {copied ? "Copied" : "Copy"}</Button><Button className="flex-1 bg-black text-white" size="xl" onClick={onClose}>Done</Button></div>
      <p className="mt-3 text-center text-[14px]"><Link href="#" className="hidden">.</Link>Saved from your booking. Works with no network.</p>
    </div>
  );
}
