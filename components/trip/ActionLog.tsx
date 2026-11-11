"use client";
import { CheckCircle2, CircleX, Eye, FileText, Hand, Search, ShieldAlert, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { TripGate } from "./TripGate";
import { useTrip } from "./TripProvider";
import { Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { inr } from "@/lib/time";

type Row = { id: string; tool: string; input: Record<string, unknown>; output: Record<string, unknown> | null; status: string; latencyMs: number | null; at: string };

function describe(r: Row): { icon: React.ReactNode; text: string; tone: string } {
  const o = r.output ?? {};
  switch (r.tool) {
    case "get_itinerary": return { icon: <Eye size={18} />, text: "Looked up your trip", tone: "text-muted" };
    case "get_route": return { icon: <Search size={18} />, text: `Looked up a route${o.from ? `: ${o.from} to ${o.to}` : ""}`, tone: "text-muted" };
    case "search_flights": return { icon: <Search size={18} />, text: "Looked for other flights", tone: "text-muted" };
    case "search_stays": return { icon: <Search size={18} />, text: "Checked extra-night availability", tone: "text-muted" };
    case "quote_change": return { icon: <FileText size={18} />, text: `Priced a change: ${inr(Number(o.priceDeltaInr ?? 0))}. Nothing booked.`, tone: "text-ink" };
    case "traveller_confirm": return { icon: <Hand size={18} />, text: "You tapped Confirm", tone: "text-accent" };
    case "traveller_decline": return { icon: <Hand size={18} />, text: "You tapped Decline. Nothing changed.", tone: "text-ink" };
    case "apply_change":
      if (r.status === "ok") return { icon: <CheckCircle2 size={18} />, text: `Change applied: ${String(o.summary ?? "")} (${inr(Number(o.priceDeltaInr ?? 0))})`, tone: "text-ok" };
      if (o.error === "PRICE_CHANGED") return { icon: <ShieldAlert size={18} />, text: `Price moved (${inr(Number(o.oldDeltaInr))} to ${inr(Number(o.newDeltaInr))}). Old confirmation voided, new quote shown.`, tone: "text-warn" };
      return { icon: <ShieldAlert size={18} />, text: "Blocked: no valid Confirm tap. Nothing changed.", tone: "text-warn" };
    case "escalate_human": return { icon: <ShieldAlert size={18} />, text: `Asked our team for help. Case ${String(o.caseRef ?? "")}, severity ${String(o.severity ?? "")}`, tone: "text-danger" };
    case "send_sms": return { icon: <Sparkles size={18} />, text: "Sent you an SMS", tone: "text-muted" };
    default: return { icon: <CircleX size={18} />, text: r.tool, tone: "text-muted" };
  }
}

export function ActionLog() {
  return <TripGate>{() => <Inner />}</TripGate>;
}
function Inner() {
  const t = useTrip();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (t.net !== "online") return;
    fetch(`/api/trips/${t.ref}/log`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.message); setRows(j.log); }).catch((e) => setErr(e.message));
  }, [t.net, t.ref, t.stored?.version]);
  return (
    <div className="space-y-4">
      <h1 className="text-[32px] font-bold leading-tight">Action log</h1>
      <p className="text-muted">Every step the agent took, and every tap you made. Changes only happen after your Confirm tap.</p>
      {t.net !== "online" ? <EmptyState title="The log needs data" body="Connect to the internet to see the latest log. Your offline guide still works." />
        : err ? <ErrorState body={err} />
        : !rows ? <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
        : !rows.length ? <EmptyState title="Nothing yet" body="Ask the agent a question and the steps will show here." />
        : (
          <ol className="space-y-2" data-testid="log-list">
            {rows.map((r) => {
              const d = describe(r);
              return (
                <li key={r.id}><Card className="flex items-start gap-3 !p-3"><span className={`mt-0.5 ${d.tone}`}>{d.icon}</span><div className="min-w-0 flex-1"><p className={d.tone === "text-muted" ? "" : "font-semibold"}>{d.text}</p><p className="font-mono text-[13px] text-muted">{r.tool}{r.latencyMs ? ` · ${r.latencyMs} ms` : ""} · {new Date(r.at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</p></div></Card></li>
              );
            })}
          </ol>
        )}
    </div>
  );
}
