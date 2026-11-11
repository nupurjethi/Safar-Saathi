"use client";
import { CheckCircle2, CloudOff, Loader2, MapPin, Send, ShieldAlert, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, LinkButton } from "@/components/ui/primitives";
import { TripGate } from "@/components/trip/TripGate";
import { useTrip } from "@/components/trip/TripProvider";
import { enqueue, pending, remove } from "@/lib/offline/outbox";
import { answerOffline, QUICK_QUESTIONS, type OaAnswer } from "@/lib/offline/assistant";
import { inr } from "@/lib/time";
import { OfflineAnswer } from "./OfflineAnswer";
import { ReviewCardView, type Review, type ReviewState } from "./ReviewCard";

type Step = { id: string; name: string; status: "running" | "done" | "error" };
type Receipt = { receiptId: string; summary: string; priceDeltaInr: number; newTotalInr: number; packVersion: number; bookingRef: string; guide?: { updated: boolean; regenerated: string[]; origin?: string; message: string } };
type Part =
  | { t: "review"; card: Review }
  | { t: "case"; caseRef: string; severity: number; slaSeconds: number; summary: string }
  | { t: "route"; routeId: string; fromName: string; toName: string; distance_m: number; duration_s: number; approximate: boolean; url: string }
  | { t: "receipt"; receipt: Receipt }
  | { t: "oa"; answer: OaAnswer; question: string; userId: string; queued?: boolean };
type Msg = { id: string; role: "user" | "assistant"; text: string; steps: Step[]; parts: Part[]; queued?: boolean; label?: string; ms?: number };

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
const PROMPTS = ["When is my pickup?", "Move my Paris to Rome flight later", "Extend my stay in Rome by 1 night", "How do I get from my hotel to the Colosseum?"];
let uid = 0;
const nid = () => `m${++uid}-${Date.now()}`;

export function Chat() {
  const trip = useTrip();
  const ref = trip.ref;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, { s: ReviewState; err?: string }>>({});
  const [chaos, setChaos] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const online = trip.net === "online";
  // The offline assistant answers when there is no data, when the traveller switches it on, or when the online agent cannot be reached.
  const [forceOffline, setForceOffline] = useState(false);
  const offlineMode = !online || forceOffline;
  const pack = trip.pack;

  // restore history when online
  useEffect(() => {
    if (!online || loaded) return;
    fetch(`/api/agent?bookingRef=${ref}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!j) return;
      setThreadId(j.threadId);
      const st: Record<string, { s: ReviewState }> = {};
      const restored: Msg[] = j.messages.map((m: { id: string; role: "user" | "assistant"; text: string; parts: (Part & { quoteStatus?: string })[] }) => {
        for (const p of m.parts) if (p.t === "review") st[p.card.quoteId] = { s: p.quoteStatus === "applied" ? "applied" : p.quoteStatus === "declined" ? "declined" : p.quoteStatus === "void" ? "repriced" : p.quoteStatus === "expired" ? "expired" : "idle" };
        return { id: m.id, role: m.role, text: m.text, steps: [], parts: m.parts };
      });
      setMsgs((cur) => (cur.length ? cur : restored));
      setStates((cur) => ({ ...st, ...cur }));
    }).catch(() => {}).finally(() => setLoaded(true));
  }, [online, loaded, ref]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [msgs]);

  /** Replaces the (empty or failed) assistant bubble with an answer from the saved bundle. Returns false if there is no bundle. */
  const localFallback = useCallback((assistantId: string, text: string, userId: string, note?: string) => {
    if (!pack) return false;
    const answer = answerOffline(pack, text, { now: new Date() });
    setMsgs((all) => all.map((x) => (x.id === assistantId && !x.text ? { ...x, text: note ?? "The online agent could not be reached, so I answered from the guide saved on your phone.", steps: [], parts: [{ t: "oa", answer, question: text, userId }], label: "Offline assistant" } : x)));
    return true;
  }, [pack]);

  const stream = useCallback(async (text: string, userMsgId?: string) => {
    const aId = nid();
    const uId = userMsgId ?? nid();
    setBusy(true);
    setMsgs((m) => [...(userMsgId ? m.map((x) => (x.id === userMsgId ? { ...x, queued: false } : x)) : [...m, { id: uId, role: "user" as const, text, steps: [], parts: [] }]), { id: aId, role: "assistant", text: "", steps: [], parts: [] }]);
    const patch = (fn: (m: Msg) => Msg) => setMsgs((all) => all.map((x) => (x.id === aId ? fn(x) : x)));
    try {
      const res = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingRef: ref, message: text, threadId, chaos: chaos ? "price_move" : undefined }) });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        if (res.status !== 401 && res.status !== 429 && localFallback(aId, text, uId)) return; // the online agent failed: answer from the saved bundle
        patch((m) => ({ ...m, text: res.status === 401 ? "Please sign in again." : (j.message ?? "I could not answer just now.") }));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          const e = JSON.parse(line);
          if (e.t === "thread") setThreadId(e.id);
          else if (e.t === "step") patch((m) => ({ ...m, steps: m.steps.some((s) => s.id === e.id) ? m.steps.map((s) => (s.id === e.id ? { ...s, status: e.status } : s)) : [...m.steps, { id: e.id, name: e.name, status: e.status }] }));
          else if (e.t === "text") patch((m) => ({ ...m, text: m.text + e.delta }));
          else if (e.t === "review") { setStates((s) => ({ ...s, [e.card.quoteId]: { s: "idle" } })); patch((m) => ({ ...m, parts: [...m.parts, e] })); }
          else if (e.t === "case" || e.t === "route" || e.t === "receipt") patch((m) => ({ ...m, parts: [...m.parts, e] }));
          else if (e.t === "done") patch((m) => ({ ...m, label: e.label, ms: e.ms }));
          else if (e.t === "error") patch((m) => ({ ...m, text: m.text || e.message }));
        }
      }
    } catch {
      if (!localFallback(aId, text, uId)) patch((m) => ({ ...m, text: m.text || "I lost the connection. Your message is safe. Try again when you have data." }));
    } finally {
      setBusy(false);
    }
  }, [ref, threadId, chaos, localFallback]);

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    if (offlineMode) {
      const userId = nid();
      if (!pack) {
        setMsgs((m) => [...m, { id: userId, role: "user", text: t, steps: [], parts: [] }, { id: nid(), role: "assistant", text: "This trip is not saved on this phone yet, so I cannot answer offline. Open it once with data.", steps: [], parts: [] }]);
        return;
      }
      const answer = answerOffline(pack, t, { now: new Date() });
      setMsgs((m) => [...m, { id: userId, role: "user", text: t, steps: [], parts: [] }, { id: nid(), role: "assistant", text: "", steps: [], parts: [{ t: "oa", answer, question: t, userId }], label: "Answered on this phone, no network used" }]);
      return;
    }
    void stream(t);
  }, [busy, offlineMode, pack, stream]);

  /** Queue a question for the online Trip agent (sent when there is data). The offline assistant never changes anything. */
  const queueForAgent = useCallback(async (assistantMsgId: string, p: { question: string; userId: string }) => {
    if (online) { void stream(p.question, p.userId); return; }
    await enqueue({ ref, kind: "chat", payload: { text: p.question, localId: p.userId } }).catch(() => {});
    setMsgs((all) => all.map((x) => (x.id === assistantMsgId ? { ...x, parts: x.parts.map((q) => (q.t === "oa" ? { ...q, queued: true } : q)) } : x)));
  }, [ref, online, stream]);

  // flush the outbox when we get back online
  useEffect(() => {
    if (!online || busy) return;
    void (async () => {
      const q = await pending(ref, "chat").catch(() => []);
      if (!q.length) return;
      const it = q[0];
      await remove(it.id!);
      void stream(String(it.payload.text), String(it.payload.localId));
    })();
  }, [online, busy, ref, stream]);

  const setState = (quoteId: string, s: ReviewState, err?: string) => setStates((cur) => ({ ...cur, [quoteId]: { s, err } }));

  const confirm = async (card: Review) => {
    setState(card.quoteId, "confirming");
    try {
      // The Confirm tap: an authenticated request mints a single-use token (only its hash is stored).
      const c = await fetch("/api/confirmations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteId: card.quoteId }) });
      const cj = await c.json();
      if (!c.ok) return setState(card.quoteId, c.status === 410 ? "expired" : "error", cj.message);
      const a = await fetch("/api/mock/v1/changes/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteId: card.quoteId, token: cj.token, threadId }) });
      const aj = await a.json();
      if (a.status === 409 && aj.error === "PRICE_CHANGED") {
        const nq = aj.newQuote as Review;
        setState(card.quoteId, "repriced");
        setStates((s) => ({ ...s, [nq.quoteId]: { s: "idle" } }));
        setMsgs((m) => [...m, { id: nid(), role: "assistant", steps: [], text: `The price moved from ${inr(card.priceDeltaInr)} to ${inr(nq.priceDeltaInr)} before I could book it. Nothing was booked, and your earlier tap is void. Please review the new price.`, parts: [{ t: "review", card: nq }] }]);
        return;
      }
      if (!a.ok) return setState(card.quoteId, "error", aj.message);
      setState(card.quoteId, "applied");
      const receipt = aj.receipt as Receipt;
      setMsgs((m) => [...m, { id: nid(), role: "assistant", steps: [], text: "Done. Your change is confirmed.", parts: [{ t: "receipt", receipt }] }]);
      void trip.sync(); // the pack was rebuilt on the server: pull the new version
    } catch {
      setState(card.quoteId, "error", "No connection. Nothing was changed. Try again when you have data.");
    }
  };
  const decline = async (card: Review) => {
    setState(card.quoteId, "declined");
    await fetch("/api/confirmations/decline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteId: card.quoteId }) }).catch(() => {});
    setMsgs((m) => [...m, { id: nid(), role: "assistant", steps: [], text: "No problem. Nothing was changed. Want a different time or date?", parts: [] }]);
  };

  return (
    <div className="flex min-h-[calc(100dvh-13rem)] flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[24px] font-semibold">Trip agent</h1>
        <Link href={`/trips/${ref}/log`} className="text-[15px] text-accent underline">See action log</Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setForceOffline((v) => !v)} aria-pressed={offlineMode} disabled={!online} data-testid="offline-assistant" className={`inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] px-4 text-[15px] font-semibold ${offlineMode ? "border-lime bg-lime text-lime-ink" : "border-line bg-surface"} disabled:opacity-100`}>
          <CloudOff size={16} /> Offline assistant{offlineMode ? ": on" : ""}
        </button>
        <span className="text-[13px] text-muted">{!online ? "No data, so this is answering from the guide saved on your phone." : forceOffline ? "Answers come from your saved bundle. No network, no AI model." : "Switch on to answer from your saved bundle with no network."}</span>
      </div>
      {!online && <p role="status" className="rounded-xl border border-warn p-3 text-warn">You are offline. The online Trip agent needs data. The offline assistant answers from your saved booking and guides, and cannot change anything. Questions it cannot answer can be queued for the agent.</p>}

      <div className="flex flex-1 flex-col gap-4" aria-live="polite" aria-relevant="additions text" data-testid="chat-log">
        {!msgs.length && (
          <div className="space-y-3">
            <p className="text-muted">{offlineMode ? "Ask about your trip. I answer from the booking and guides saved on this phone. I cannot change anything." : "Ask about your trip. I only answer from your booking. Changes always need your Confirm tap."}</p>
            <div className="flex flex-wrap gap-2">{(offlineMode ? QUICK_QUESTIONS : PROMPTS).map((p) => <button key={p} onClick={() => void send(p)} data-testid={offlineMode ? "oa-chip" : undefined} className="min-h-11 rounded-full border-[1.5px] border-line bg-surface px-4 text-left text-[15px] hover:border-muted">{p}</button>)}</div>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={m.role === "user" ? "ml-auto max-w-[85%]" : "mr-auto w-full"} data-role={m.role}>
            {m.role === "user" ? (
              <div className="rounded-2xl rounded-br-md bg-lime px-4 py-2.5 text-lime-ink">{m.text}{m.queued && <span className="ml-2 text-[13px] opacity-80">· Queued</span>}</div>
            ) : (
              <div className="space-y-2">
                {m.steps.length > 0 && <div className="flex flex-wrap gap-1.5" aria-label="Steps the agent took">{m.steps.map((s) => <StepChip key={s.id} s={s} />)}</div>}
                {m.text ? <div className="card-2 whitespace-pre-wrap px-4 py-3" data-testid="assistant-text">{m.text}</div> : (!m.parts.length && <div className="typing card-2 inline-block px-4 py-3" aria-label="Agent is typing"><span /><span /><span /></div>)}
                {m.parts.some((p) => p.t === "review") && m.parts.filter((p) => p.t === "review").length > 1 && <p className="text-[15px] font-semibold" data-testid="options-heading">Choose an option ({m.parts.filter((p) => p.t === "review").length}). Compare the breakups, then tap Yes on one or No.</p>}
                {m.parts.map((p, i) => p.t === "oa" && pack
                  ? <OfflineAnswer key={i} answer={p.answer} pack={pack} now={trip.now} online={online} queued={p.queued} onAsk={(q) => void send(q)} onQueue={() => void queueForAgent(m.id, p)} />
                  : <PartView key={i} p={p} states={states} onConfirm={confirm} onDecline={decline} refCode={ref} />)}
                {m.label && <p className="text-[13px] text-muted">{m.label}{m.ms ? ` · ${(m.ms / 1000).toFixed(1)} s` : ""}</p>}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void send(input); }} className="sticky bottom-20 flex gap-2 rounded-2xl bg-bg/95 pb-2 pt-2 sm:bottom-4">
        <label htmlFor="chat-input" className="sr-only">Message the trip agent</label>
        <input id="chat-input" value={input} onChange={(e) => setInput(e.target.value)} maxLength={800} placeholder={offlineMode ? "Ask the offline assistant…" : "Ask about your trip…"} className="min-h-12 flex-1 rounded-xl border-[1.5px] border-line bg-surface px-4 text-[17px] placeholder:text-muted" autoComplete="off" />
        <Button type="submit" variant="primary" disabled={busy || !input.trim()} aria-label="Send">{busy ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}</Button>
      </form>
      {DEMO && (
        <label className="flex items-center gap-2 text-[14px] text-muted"><input type="checkbox" checked={chaos} onChange={(e) => setChaos(e.target.checked)} className="size-4 accent-[var(--lime)]" /> Demo: move the price by 5 to 15% before I confirm (shows re-quoting)</label>
      )}
    </div>
  );
}

function StepChip({ s }: { s: Step }) {
  const icon = s.status === "running" ? <Loader2 size={13} className="animate-spin" /> : s.status === "done" ? <CheckCircle2 size={13} className="text-ok" /> : <XCircle size={13} className="text-danger" />;
  return <span data-testid="step-chip" className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-[13px]">{icon}{s.name}</span>;
}

function PartView({ p, states, onConfirm, onDecline, refCode }: { p: Part; states: Record<string, { s: ReviewState; err?: string }>; onConfirm: (c: Review) => void; onDecline: (c: Review) => void; refCode: string }) {
  if (p.t === "review") {
    const st = states[p.card.quoteId] ?? { s: "idle" as ReviewState };
    return <ReviewCardView card={p.card} state={st.s} error={st.err} onConfirm={() => onConfirm(p.card)} onDecline={() => onDecline(p.card)} />;
  }
  if (p.t === "receipt") {
    const r = p.receipt;
    return (
      <section data-testid="receipt-card" className="card space-y-2 border-ok p-4">
        <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-[20px] font-semibold"><CheckCircle2 className="text-ok" size={22} /> Receipt</h3><Badge tone={r.guide && !r.guide.updated ? "warn" : "ok"}>{r.guide && !r.guide.updated ? "Guide not updated" : `Offline guide updated · v${r.packVersion}`}</Badge></div>
        <p>{r.summary}</p>
        {r.guide && <p className="text-[15px]" data-testid="guide-update">{r.guide.message}{r.guide.regenerated.length ? ` Refreshed: ${r.guide.regenerated.join(", ")}.` : ""}</p>}
        <dl className="grid grid-cols-2 gap-2 text-[15px]"><dt className="text-muted">Paid now (test payment)</dt><dd className="text-right font-semibold">{inr(r.priceDeltaInr)}</dd><dt className="text-muted">New trip total</dt><dd className="text-right font-semibold">{inr(r.newTotalInr)}</dd><dt className="text-muted">Receipt</dt><dd className="text-right font-mono">{r.receiptId}</dd></dl>
        <Link href={`/trips/${refCode}/log`} className="text-accent underline">See action log</Link>
      </section>
    );
  }
  if (p.t === "oa") return null; // rendered by Chat itself (needs the saved pack)
  if (p.t === "case") {
    return (
      <section data-testid="case-card" className={`card space-y-1 p-4 ${p.severity === 1 ? "border-danger" : "border-warn"}`}>
        <p className="flex items-center gap-2 font-semibold"><ShieldAlert size={20} className={p.severity === 1 ? "text-danger" : "text-warn"} /> Case ID <span className="font-mono">{p.caseRef}</span> · Severity {p.severity}</p>
        <p className="text-[15px] text-muted">{p.severity === 1 ? "A person has been paged. Target: 60 seconds. The agent cannot close this case." : "Our team will follow up."}</p>
        <LinkButton href={`/trips/${refCode}/guide`} size="md">Open offline guide</LinkButton>
      </section>
    );
  }
  return (
    <section className="card flex flex-wrap items-center justify-between gap-3 p-4" data-testid="route-card">
      <div><p className="font-semibold">{p.fromName} to {p.toName}</p><p className="text-[15px] text-muted">{(p.distance_m / 1000).toFixed(1)} km · {Math.round(p.duration_s / 60)} min{p.approximate ? " · sample straight-line route" : ""}</p></div>
      <LinkButton href={p.url} size="md" variant="primary"><MapPin size={18} /> Open on map</LinkButton>
    </section>
  );
}

export function ChatScreen() {
  return <TripGate>{() => <Chat />}</TripGate>;
}
