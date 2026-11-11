"use client";
import { CloudOff, LifeBuoy, MapPin, Phone, Send } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Button } from "@/components/ui/primitives";
import { ASSISTANT_LABEL, walkScenario, type OaAnswer } from "@/lib/offline/assistant";
import type { OfflinePack } from "@/lib/packs/types";
import { telHref } from "@/lib/trip/derive";

/**
 * One answer from the offline, rule-based assistant. It reads only the saved bundle, so it renders with no network.
 * Scenario answers keep their decision tree: tapping an option re-walks the saved rule set on the phone.
 */
export function OfflineAnswer({ answer, pack, now, online, onAsk, onQueue, queued }: {
  answer: OaAnswer; pack: OfflinePack; now: Date; online: boolean; onAsk: (q: string) => void; onQueue?: () => void; queued?: boolean;
}) {
  const [path, setPath] = useState<string[]>([]);
  const view = useMemo(() => (answer.scenarioId && path.length ? walkScenario(pack, answer.scenarioId, path, { now, city: answer.city }) ?? answer : answer), [answer, path, pack, now]);
  const calls = [...new Map(view.steps.filter((s) => s.call && /\d/.test(s.call)).map((s) => [s.call!, s.callLabel ?? "Call"])).entries()];
  const showCards = [...new Set(view.steps.map((s) => s.show).filter(Boolean) as string[])];
  const tone = answer.urgent ? "border-danger" : answer.low ? "border-warn" : "border-line";
  return (
    <section data-testid="oa-answer" data-intent={answer.intent} className={`card space-y-3 border-[1.5px] p-4 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="muted" data-testid="oa-label"><CloudOff size={13} /> {ASSISTANT_LABEL}</Badge>
        {answer.generic && <Badge tone="warn">General guidance</Badge>}
        {answer.urgent && <Badge tone="danger">Urgent</Badge>}
      </div>
      <h3 className="text-[20px] font-semibold leading-tight">{answer.title}</h3>

      {showCards.map((s) => <p key={s} className="rounded-xl border border-lime p-3 text-[20px] font-semibold leading-snug"><span className="block text-[12px] font-semibold uppercase tracking-wide text-accent">Show this to a driver</span>{s}</p>)}

      {view.lines.length > 0 && <div className="space-y-1.5">{view.lines.map((l, i) => <p key={i} className={i === 0 && view.lines.length > 1 && !answer.scenarioId ? "font-semibold" : ""}>{l}</p>)}</div>}

      {view.steps.length > 0 && (
        <ol className="space-y-2" data-testid="oa-steps">
          {view.steps.map((s, i) => (
            <li key={i} className="flex gap-3 rounded-xl border border-line bg-surface-2/50 p-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-lime text-[14px] font-bold text-lime-ink">{i + 1}</span>
              <span className="leading-snug">{s.text}</span>
            </li>
          ))}
        </ol>
      )}

      {view.ask && (
        <div className="space-y-2 rounded-xl border border-line p-3">
          <p className="font-semibold">{view.ask.question}</p>
          <div className="flex flex-wrap gap-2">{view.ask.options.map((o) => <Button key={o.branch} size="md" onClick={() => setPath((p) => [...p, o.branch])} data-testid="oa-option">{o.label}</Button>)}</div>
        </div>
      )}
      {path.length > 0 && <button className="text-[14px] text-accent underline" onClick={() => setPath([])}>Start over</button>}

      {(calls.length > 0 || answer.links.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {calls.map(([n, l]) => <Link key={n} href={telHref(n)} className="inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] border-line bg-surface px-4 text-[15px] font-semibold"><Phone size={16} /> {l} <span className="font-mono font-normal">{n}</span></Link>)}
          {answer.links.filter((l) => !calls.some(([n]) => l.kind === "call" && l.href === telHref(n))).map((l) => (
            <Link key={l.href + l.label} href={l.href} className={`inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] px-4 text-[15px] font-semibold ${l.label.startsWith("SOS") || l.label === "Open SOS" || l.label.startsWith("Still stuck") ? "border-danger text-danger" : "border-line bg-surface"}`}>
              {l.kind === "call" ? <Phone size={16} /> : l.kind === "map" ? <MapPin size={16} /> : <LifeBuoy size={16} />} {l.label}
            </Link>
          ))}
        </div>
      )}

      {answer.needsOnline && <p role="note" className="rounded-xl border border-warn p-3 text-[15px]">Changes need a connection and your Confirm tap. Nothing was changed.</p>}
      {answer.missing.length > 0 && <p className="text-[13px] text-warn">Some details are not in your booking: {answer.missing.join(", ")}.</p>}

      {(answer.low || answer.needsOnline) && onQueue && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="md" variant="primary" onClick={onQueue} disabled={queued} data-testid="oa-queue"><Send size={16} /> {queued ? "Queued for the Trip agent" : online ? "Ask the Trip agent instead" : "Queue for the Trip agent"}</Button>
          {!online && <span className="text-[13px] text-muted">Sent when you are back online.</span>}
        </div>
      )}

      {answer.alternatives.length > 0 && (
        <div className="flex flex-wrap items-center gap-2"><span className="text-[13px] text-muted">Did you mean</span>{answer.alternatives.map((a) => <button key={a.intent} onClick={() => onAsk(a.question)} className="min-h-9 rounded-full border border-line bg-surface px-3 text-[14px]">{a.question}</button>)}</div>
      )}
      {answer.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Suggested questions">{answer.suggestions.map((q) => <button key={q} onClick={() => onAsk(q)} data-testid="oa-chip" className="min-h-9 rounded-full border border-line bg-surface px-3 text-[14px] hover:border-muted">{q}</button>)}</div>
      )}
      {answer.cites.length > 0 && <p className="text-[12px] text-muted" data-testid="oa-cites">Source: {answer.cites.join(" · ")}</p>}
    </section>
  );
}
