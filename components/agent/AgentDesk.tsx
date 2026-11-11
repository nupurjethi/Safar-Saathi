"use client";
import { BellRing, MapPin, MessageSquareText, Phone, Siren, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";

type Alert = {
  id: string; caseRef: string; channel: string; kind: string; severity: number; summary: string; status: string; assignedTo: string | null; slaDueAt: string; createdAt: string;
  trip: { ref: string; title: string; start: string; end: string; pax: number } | null;
  traveller: { name: string; phone: string | null } | null;
  location: { lat: number; lon: number } | null;
};
type Feed = { now: string; me: { name: string; role: string }; cases: Alert[]; sms: { provider: string; number: string | null; lastPoll: string; pollError: string | null; sent: number; cap: number } };

const fmtClock = (s: number) => `${Math.floor(Math.abs(s) / 60)}:${String(Math.abs(s) % 60).padStart(2, "0")}`;
const ago = (iso: string, now: number) => { const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.25, 0.5].forEach((t) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "square"; o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.15); });
    setTimeout(() => void ctx.close(), 1200);
  } catch { /* no audio available */ }
}

/** The agent's desk: every SOS tap, SMS and help request lands here, newest and most severe first, and new ones raise an alarm. */
export function AgentDesk() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [auth, setAuth] = useState<"ok" | "no">("ok");
  const [now, setNow] = useState(0);
  const [fresh, setFresh] = useState<Alert[]>([]);
  const [sound, setSound] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const soundRef = useRef(false);
  useEffect(() => { soundRef.current = sound; }, [sound]);
  const baseTitle = useRef("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/agent/alerts", { cache: "no-store" });
      if (r.status === 401 || r.status === 403) return setAuth("no");
      const j = (await r.json()) as Feed;
      setAuth("ok");
      setFeed(j);
      if (seen.current === null) { seen.current = new Set(j.cases.map((c) => c.id)); return; } // the first load is not "new"
      const added = j.cases.filter((c) => !seen.current!.has(c.id) && c.status === "open");
      for (const c of j.cases) seen.current.add(c.id);
      if (added.length) {
        setFresh((f) => [...added, ...f].slice(0, 5));
        if (soundRef.current) beep();
        if (typeof Notification !== "undefined" && Notification.permission === "granted") added.forEach((c) => new Notification(`${c.severity === 1 ? "EMERGENCY" : "Help request"} ${c.caseRef}`, { body: c.summary.slice(0, 140), tag: c.id }));
      }
    } catch { /* offline blip: keep the last feed */ }
  }, []);

  useEffect(() => {
    baseTitle.current = document.title;
    setNow(Date.now()); void load();
    const a = setInterval(load, 5000), b = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(a); clearInterval(b); document.title = baseTitle.current; };
  }, [load]);

  const open = feed?.cases.filter((c) => c.status !== "closed") ?? [];
  const unattended = open.filter((c) => c.status === "open");
  const sev1 = unattended.filter((c) => c.severity === 1);
  useEffect(() => { if (baseTitle.current) document.title = unattended.length ? `(${unattended.length}) ${sev1.length ? "EMERGENCY" : "Alerts"} · Agent desk` : baseTitle.current; }, [unattended.length, sev1.length]);

  const act = async (id: string, action: "take" | "close") => { await fetch(`/api/admin/cases/${id}/take`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }); void load(); };
  const toggleSound = async () => {
    const on = !sound;
    setSound(on);
    if (on) { beep(); try { if (typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission(); } catch {} }
  };

  if (auth === "no") return <ErrorState title="Agents only" body="Sign in as an agent from the home page to open the desk." retry={undefined} />;
  if (!feed) return <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>;
  const sorted = [...feed.cases].sort((a, b) => Number(a.status === "closed") - Number(b.status === "closed") || a.severity - b.severity || b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-5" data-testid="agent-desk">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-[15px] text-muted">Signed in as {feed.me.name}</p><h1 className="text-[32px] font-bold leading-tight">Agent desk</h1></div>
        <Button size="md" variant={sound ? "primary" : "secondary"} onClick={toggleSound} data-testid="sound-toggle" aria-pressed={sound}>{sound ? <Volume2 size={18} /> : <VolumeX size={18} />} {sound ? "Alarm sound on" : "Turn alarm sound on"}</Button>
      </div>

      {fresh.length > 0 && (
        <div role="alert" data-testid="new-alert" className="space-y-2 rounded-2xl border-2 border-danger bg-danger/10 p-4">
          <div className="flex items-center justify-between gap-2"><p className="flex items-center gap-2 text-[18px] font-bold text-danger"><Siren className="animate-pulse" /> New alert{fresh.length > 1 ? `s (${fresh.length})` : ""}</p><Button size="md" onClick={() => setFresh([])}>Dismiss</Button></div>
          {fresh.map((c) => <p key={c.id} className="text-[16px]"><b>{c.caseRef}</b> · {c.kind} · severity {c.severity}{c.trip ? ` · ${c.trip.ref}` : ""}: {c.summary.slice(0, 160)}</p>)}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="desk-stats">
        <Card className={sev1.length ? "border-danger" : ""}><p className="text-[13px] text-muted">Emergencies waiting</p><p className={`font-display text-[36px] font-bold ${sev1.length ? "text-danger" : ""}`}>{sev1.length}</p></Card>
        <Card><p className="text-[13px] text-muted">Open alerts</p><p className="font-display text-[36px] font-bold">{unattended.length}</p></Card>
        <Card><p className="text-[13px] text-muted">Being handled</p><p className="font-display text-[36px] font-bold">{open.length - unattended.length}</p></Card>
        <Card><p className="text-[13px] text-muted">SMS channel</p><p className="text-[17px] font-semibold">{feed.sms.provider === "twilio" ? "Twilio live" : "Simulator"}</p><p className="font-mono text-[12px] text-muted">{feed.sms.number ?? "no number"}</p></Card>
      </div>
      {feed.sms.pollError && <p role="status" className="text-[14px] text-warn">Could not read Twilio just now ({feed.sms.pollError}). Retrying.</p>}

      {!sorted.length ? <EmptyState title="All quiet" body="SOS taps, texts to the helpline and help requests from the chat appear here the moment they arrive." /> : (
        <ul className="space-y-3" data-testid="alert-list">
          {sorted.map((c) => {
            const left = Math.round((new Date(c.slaDueAt).getTime() - now) / 1000);
            const closed = c.status === "closed";
            return (
              <li key={c.id}>
                <Card className={`space-y-3 ${closed ? "opacity-60" : ""} ${!closed && c.severity === 1 ? "border-danger" : ""}`} data-testid="alert-row" data-sev={c.severity} data-status={c.status}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={c.severity === 1 ? "danger" : c.severity === 2 ? "warn" : "muted"}>{c.severity === 1 ? "EMERGENCY" : `Severity ${c.severity}`}</Badge>
                    <span className="inline-flex items-center gap-1 text-[15px] font-semibold">{c.channel === "sms" ? <MessageSquareText size={16} /> : <BellRing size={16} />}{c.kind}</span>
                    <span className="font-mono text-[14px] text-muted">{c.caseRef}</span>
                    <Badge tone={c.status === "open" ? "warn" : c.status === "taken" ? "lime" : "ok"}>{c.status === "taken" ? `Handling${c.assignedTo ? ` · ${c.assignedTo}` : ""}` : c.status === "closed" ? "Resolved" : "Waiting"}</Badge>
                    <span className="ml-auto text-[14px] text-muted">{ago(c.createdAt, now)}</span>
                    {!closed && <span data-testid="sla" className={`font-mono text-[15px] ${left < 0 ? "text-danger" : "text-muted"}`}>{left >= 0 ? `SLA ${fmtClock(left)}` : `Overdue ${fmtClock(left)}`}</span>}
                  </div>
                  <p className="text-[17px] leading-snug">{c.summary}</p>
                  <dl className="grid gap-x-6 gap-y-1 text-[15px] sm:grid-cols-2">
                    {c.traveller && <div className="flex gap-2"><dt className="text-muted">Traveller</dt><dd className="font-medium">{c.traveller.name}{c.traveller.phone ? <span className="ml-2 inline-flex items-center gap-1 font-mono text-[13px] text-muted"><Phone size={12} />{c.traveller.phone}</span> : null}</dd></div>}
                    {c.trip ? <div className="flex gap-2"><dt className="text-muted">Trip</dt><dd className="font-medium">{c.trip.title} <span className="font-mono text-[13px] text-muted">{c.trip.ref}</span> · {c.trip.pax} travellers · {c.trip.start} to {c.trip.end}</dd></div> : <div className="flex gap-2"><dt className="text-muted">Trip</dt><dd className="text-warn">Not matched to a booking yet</dd></div>}
                    {c.location && <div className="flex gap-2"><dt className="text-muted">Last location</dt><dd><a className="inline-flex items-center gap-1 text-accent underline" href={`https://www.openstreetmap.org/?mlat=${c.location.lat}&mlon=${c.location.lon}#map=16/${c.location.lat}/${c.location.lon}`} target="_blank" rel="noopener noreferrer"><MapPin size={14} />{c.location.lat.toFixed(4)}, {c.location.lon.toFixed(4)}</a></dd></div>}
                  </dl>
                  {!closed && <div className="flex flex-wrap gap-2">{c.status === "open" && <Button variant="primary" size="md" onClick={() => act(c.id, "take")} data-testid="take-btn">Take over</Button>}<Button size="md" onClick={() => act(c.id, "close")} data-testid="resolve-btn">Mark resolved</Button></div>}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[13px] text-muted">Refreshes every 5 seconds. Texts to the helpline number are read from Twilio and shown here as alerts. The assistant can open an alert but only a person can resolve one.{feed.sms.provider === "twilio" ? ` Replies sent by SMS so far: ${feed.sms.sent} of ${feed.sms.cap} allowed.` : ""}</p>
    </div>
  );
}
