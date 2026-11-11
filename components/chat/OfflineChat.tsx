"use client";
import { CloudOff, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { TripGate } from "@/components/trip/TripGate";
import { useTrip } from "@/components/trip/TripProvider";
import { enqueue } from "@/lib/offline/outbox";
import { answerOffline, QUICK_QUESTIONS, type OaAnswer } from "@/lib/offline/assistant";
import type { OfflinePack } from "@/lib/packs/types";
import { ChatTabs } from "./ChatTabs";
import { OfflineAnswer } from "./OfflineAnswer";

type OaMsg = { id: string; role: "user" | "assistant"; text: string; answer?: OaAnswer; question?: string; queued?: boolean; at: number };
const MAX = 60;
const key = (ref: string) => `ss-oa-${ref}`;
let n = 0;
const nid = () => `oa${++n}-${Date.now()}`;

function load(ref: string): OaMsg[] {
  try { const raw = localStorage.getItem(key(ref)); return raw ? (JSON.parse(raw) as OaMsg[]).slice(-MAX) : []; } catch { return []; }
}
function save(ref: string, msgs: OaMsg[]) {
  try { localStorage.setItem(key(ref), JSON.stringify(msgs.slice(-MAX))); } catch { /* storage full or blocked: the chat still works for this visit */ }
}

/**
 * The offline assistant: a chat of its own, separate from the online Trip agent. Rule-based, answers only from the trip
 * saved on this phone, works in airplane mode, and keeps its history on the device.
 */
function OfflineChatInner({ pack }: { pack: OfflinePack }) {
  const trip = useTrip();
  const ref = trip.ref;
  const online = trip.net === "online";
  const [msgs, setMsgs] = useState<OaMsg[]>([]);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMsgs(load(ref)); setReady(true); }, [ref]);
  useEffect(() => { if (ready) save(ref, msgs); }, [ready, ref, msgs]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [msgs.length]);

  const ask = useCallback((text: string) => {
    const q = text.trim();
    if (!q) return;
    setInput("");
    const answer = answerOffline(pack, q, { now: new Date() });
    setMsgs((m) => [...m, { id: nid(), role: "user", text: q, at: Date.now() }, { id: nid(), role: "assistant", text: "", answer, question: q, at: Date.now() }]);
  }, [pack]);

  /** Hand a question to the online Trip agent: it is asked in that chat the next time the phone is online. */
  const queue = useCallback(async (id: string, question: string) => {
    await enqueue({ ref, kind: "chat", payload: { text: question, localId: id } }).catch(() => {});
    setMsgs((m) => m.map((x) => (x.id === id ? { ...x, queued: true } : x)));
  }, [ref]);

  const clear = () => { setMsgs([]); try { localStorage.removeItem(key(ref)); } catch { /* ignore */ } };

  return (
    <div className="flex min-h-[calc(100dvh-13rem)] flex-col gap-4" data-testid="offline-chat">
      <ChatTabs refCode={ref} active="offline" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[24px] font-semibold"><CloudOff size={22} className="text-accent" /> Offline assistant</h1>
          <p className="text-[15px] text-muted">Answers from the trip saved on this phone. Works with no internet. It cannot book or change anything.</p>
        </div>
        {msgs.length > 0 && <Button size="md" variant="ghost" onClick={clear} data-testid="oa-clear" aria-label="Clear chat"><Trash2 size={16} /> Clear</Button>}
      </div>

      <div className="flex flex-1 flex-col gap-4" aria-live="polite" aria-relevant="additions text">
        {!msgs.length && (
          <div className="space-y-3">
            <p className="text-muted">Ask about your hotel, flights, pickup, today&apos;s plan, emergency numbers, or a problem like a lost passport.</p>
            <div className="flex flex-wrap gap-2">{QUICK_QUESTIONS.map((p) => <button key={p} onClick={() => ask(p)} data-testid="oa-chip" className="min-h-11 rounded-full border-[1.5px] border-line bg-surface px-4 text-left text-[15px] hover:border-muted">{p}</button>)}</div>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={m.role === "user" ? "ml-auto max-w-[85%]" : "mr-auto w-full"} data-role={m.role}>
            {m.role === "user" ? (
              <div className="rounded-2xl rounded-br-md bg-lime px-4 py-2.5 text-lime-ink">{m.text}</div>
            ) : m.answer ? (
              <div className="space-y-2">
                <OfflineAnswer answer={m.answer} pack={pack} now={trip.now} online={online} queued={m.queued} onAsk={ask} onQueue={() => void queue(m.id, m.question ?? "")} />
                {m.queued && <p className="text-[13px] text-muted" data-testid="oa-queued-note">Saved. It will be asked when you open the Trip agent chat with internet.</p>}
              </div>
            ) : null}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="sticky bottom-20 flex gap-2 rounded-2xl bg-bg/95 pb-2 pt-2 sm:bottom-4">
        <label htmlFor="oa-input" className="sr-only">Ask the offline assistant</label>
        <input id="oa-input" data-testid="oa-input" value={input} onChange={(e) => setInput(e.target.value)} maxLength={300} placeholder="Ask the offline assistant…" className="min-h-12 flex-1 rounded-xl border-[1.5px] border-line bg-surface px-4 text-[16px] placeholder:text-muted" autoComplete="off" />
        <Button type="submit" variant="primary" disabled={!input.trim()} aria-label="Ask"><Send size={20} /></Button>
      </form>
    </div>
  );
}

export function OfflineChatScreen() {
  return <TripGate>{(pack) => <OfflineChatInner pack={pack} />}</TripGate>;
}
