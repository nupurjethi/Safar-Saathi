"use client";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorState, LinkButton, Skeleton } from "@/components/ui/primitives";

type C = { id: string; caseRef: string; bookingRef: string | null; channel: string; severity: number; summary: string; status: string; assignedTo: string | null; slaDueAt: string; createdAt: string };

export function AdminCases() {
  const [cases, setCases] = useState<C[] | null>(null);
  const [auth, setAuth] = useState<"ok" | "no">("ok");
  const [now, setNow] = useState(0);
  const load = useCallback(async () => {
    const r = await fetch("/api/admin/cases", { cache: "no-store" });
    if (r.status === 401 || r.status === 403) return setAuth("no");
    const j = await r.json();
    setAuth("ok"); setCases(j.cases);
  }, []);
  useEffect(() => { setNow(Date.now()); void load(); const a = setInterval(load, 5000); const b = setInterval(() => setNow(Date.now()), 1000); return () => { clearInterval(a); clearInterval(b); }; }, [load]);
  const act = async (id: string, action: "take" | "close") => { await fetch(`/api/admin/cases/${id}/take`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }); void load(); };

  if (auth === "no") return <ErrorState title="Staff only" body="Sign in as Support agent or Admin to open the case inbox." retry={undefined} />;
  if (!cases) return <div className="space-y-2"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-[32px] font-bold leading-tight">Case inbox</h1><Badge tone="muted">Auto-refresh 5 s</Badge></div>
      {!cases.length ? <EmptyState title="No cases" body="Severity-1 SOS taps and SMS messages open cases here. Try the SMS simulator." action={<LinkButton href="/admin/sms-sim" variant="primary">Open SMS simulator</LinkButton>} /> : (
        <ul className="space-y-3" data-testid="case-list">
          {cases.map((c) => {
            const left = Math.round((new Date(c.slaDueAt).getTime() - now) / 1000);
            const open = c.status !== "closed";
            return (
              <li key={c.id}><Card className={`space-y-2 ${c.severity === 1 && open ? "border-danger" : ""}`} data-testid="case-row" data-sev={c.severity}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={c.severity === 1 ? "danger" : c.severity === 2 ? "warn" : "muted"}>Severity {c.severity}</Badge>
                  <span className="font-mono font-semibold">{c.caseRef}</span><Badge>{c.channel.toUpperCase()}</Badge>
                  {c.bookingRef && <span className="font-mono text-muted">{c.bookingRef}</span>}
                  <Badge tone={c.status === "open" ? "warn" : c.status === "taken" ? "lime" : "ok"}>{c.status}{c.assignedTo ? ` · ${c.assignedTo}` : ""}</Badge>
                  {open && <span className={`ml-auto font-mono text-[15px] ${left < 0 ? "text-danger" : "text-muted"}`} data-testid="sla">{left >= 0 ? `SLA ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : `Overdue ${Math.floor(-left / 60)}:${String(-left % 60).padStart(2, "0")}`}</span>}
                </div>
                <p>{c.summary}</p>
                {open && <div className="flex gap-2">{c.status === "open" && <Button variant="primary" size="md" onClick={() => act(c.id, "take")}>Take over</Button>}<Button size="md" onClick={() => act(c.id, "close")}>Close (human only)</Button></div>}
              </Card></li>
            );
          })}
        </ul>
      )}
      <p className="text-[14px] text-muted">The agent can open a case but never close one. Severity-1 paging is a STUB: it marks the case here and logs it; connect your pager in lib/server/cases.ts.</p>
    </div>
  );
}
