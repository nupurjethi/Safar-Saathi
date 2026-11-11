"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card } from "@/components/ui/primitives";

type M = { id: string; direction: "in" | "out"; from: string; body: string; at: string };
const SAMPLES = ["SOS lost passport SS-48213", "Where is my pickup?", "My driver didn't come. SS-48213", "What is my hotel address?", "Ambulance needed, my father collapsed. SS-48213"];

/** Simulates inbound and outbound SMS without a gateway. Uses the same handler as the real webhook. */
export function SmsSim() {
  const [msgs, setMsgs] = useState<M[]>([]);
  const [from, setFrom] = useState("+919800000001");
  const [body, setBody] = useState(SAMPLES[0]);
  const [busy, setBusy] = useState(false);
  const [auth, setAuth] = useState(true);
  const end = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/sms/sim", { cache: "no-store" });
    if (r.status === 401 || r.status === 403) return setAuth(false);
    setMsgs((await r.json()).messages);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs]);
  const send = async () => {
    setBusy(true);
    await fetch("/api/sms/sim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, body }) });
    await load(); setBusy(false);
  };
  if (!auth) return <Card>Staff only. Sign in as Support agent or Admin.</Card>;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-[32px] font-bold leading-tight">SMS simulator</h1>
      <p className="rounded-xl border border-warn p-3 text-[15px]">Simulated. No gateway is connected. Real SMS works over cellular signal, not mobile data, and never in airplane mode.</p>
      <div className="card h-80 space-y-2 overflow-y-auto p-3" aria-live="polite" data-testid="sms-thread">
        {msgs.map((m) => <div key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-2 ${m.direction === "in" ? "ml-auto bg-lime text-lime-ink" : "bg-surface-2"}`}>{m.body}<div className="mt-0.5 font-mono text-[11px] opacity-70">{m.direction === "in" ? `from ${m.from}` : "reply"} · {new Date(m.at).toLocaleTimeString("en-GB", { hourCycle: "h23" })}</div></div>)}
        {!msgs.length && <p className="p-4 text-center text-muted">No messages yet.</p>}<div ref={end} />
      </div>
      <div className="flex flex-wrap gap-2">{SAMPLES.map((s) => <button key={s} onClick={() => setBody(s)} className="min-h-10 rounded-full border border-line bg-surface px-3 text-[14px]">{s}</button>)}</div>
      <label className="block text-[15px] text-muted">From number<input value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-line bg-surface-2 px-3 font-mono text-ink" /></label>
      <label className="block text-[15px] text-muted">Message<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={500} className="mt-1 w-full rounded-xl border-[1.5px] border-line bg-surface-2 px-3 py-2 text-[17px] text-ink" data-testid="sms-body" /></label>
      <Button variant="primary" size="lg" block disabled={busy || !body.trim()} onClick={send} data-testid="sms-send">{busy ? "Sending…" : "Send as traveller"}</Button>
    </div>
  );
}
