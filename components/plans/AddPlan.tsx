"use client";
import { CheckCircle2, FileText, Loader2, TriangleAlert, Upload, X, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, Card, LinkButton } from "@/components/ui/primitives";

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 12;
const ACCEPT = ".pdf,.docx,.xlsx,.csv,.tsv,.txt,.md,.eml,.html,.htm,.json,.ics,.jpg,.jpeg,.png,.webp,image/*,application/pdf";
type Row = { file: File; state: "queued" | "uploading" | "read" | "skipped" | "error"; note?: string };
type Phase = "pick" | "working" | "done" | "error";

const size = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** "Add travel plan": upload existing bookings and itineraries; the agent builds the whole offline bundle from them. */
export function AddPlan() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [drag, setDrag] = useState(false);
  const [phase, setPhase] = useState<Phase>("pick");
  const [steps, setSteps] = useState<{ label: string; done: boolean }[]>([]);
  const [result, setResult] = useState<{ ref: string; warnings: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    setErr(null);
    const next = [...rows];
    for (const f of Array.from(list)) {
      if (next.length >= MAX_FILES) { setErr(`Up to ${MAX_FILES} files per plan.`); break; }
      if (next.some((r) => r.file.name === f.name && r.file.size === f.size)) continue;
      next.push(f.size > MAX_BYTES ? { file: f, state: "error", note: `Larger than 4 MB. Split it or upload a screenshot.` } : { file: f, state: "queued" });
    }
    setRows(next);
  };
  const setRow = (i: number, patch: Partial<Row>) => setRows((all) => all.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const step = (label: string) => setSteps((s) => [...s.map((x) => ({ ...x, done: true })), { label, done: false }]);

  const build = async () => {
    const usable = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.state !== "error");
    if (!usable.length) return setErr("Add at least one file.");
    setPhase("working"); setErr(null); setSteps([]);
    try {
      step("Uploading your files");
      const c = await fetch("/api/plans", { method: "POST" });
      if (c.status === 401) { router.push(`/login?role=traveller&next=${encodeURIComponent("/plans/new")}`); return; }
      if (!c.ok) throw new Error((await c.json().catch(() => ({}))).message ?? "Could not start the upload.");
      const { planId } = await c.json();
      let readable = 0;
      for (const { r, i } of usable) {
        setRow(i, { state: "uploading" });
        const fd = new FormData();
        fd.append("file", r.file);
        const u = await fetch(`/api/plans/${planId}/files`, { method: "POST", body: fd });
        const j = await u.json().catch(() => ({}));
        if (!u.ok) { setRow(i, { state: "error", note: j.message ?? "Upload failed." }); continue; }
        if (j.file.status === "parsed") { readable++; setRow(i, { state: "read" }); } else setRow(i, { state: "skipped", note: j.file.note ?? "Could not be read." });
      }
      if (!readable) throw new Error("None of the files could be read. Use PDF, Word, Excel, CSV, a photo or text.");
      const res = await fetch(`/api/plans/${planId}/process`, { method: "POST" });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).message ?? "Could not build the plan.");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const e = JSON.parse(line);
          if (e.t === "step") step(e.label);
          else if (e.t === "done") { setSteps((s) => s.map((x) => ({ ...x, done: true }))); setResult({ ref: e.ref, warnings: e.warnings ?? [] }); setPhase("done"); return; }
          else if (e.t === "error") throw new Error(e.message);
        }
      }
      throw new Error("The connection closed before the plan was ready. Try again.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("error");
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5" data-testid="add-plan">
      <div>
        <h1 className="text-[32px] font-bold leading-tight">Add your travel plan</h1>
        <p className="mt-1 text-[16px] text-muted">Already booked? Upload your tickets, hotel vouchers and itinerary. We read them with AI and build your offline guide: day plan, offline map with GPS, routes, help guides and SOS.</p>
      </div>

      {phase === "pick" || phase === "error" ? (
        <>
          <button type="button" onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
            className={`flex w-full flex-col items-center gap-2 rounded-3xl border-2 border-dashed px-4 py-10 text-center ${drag ? "border-lime bg-surface" : "border-line bg-surface-2"}`} data-testid="plan-drop">
            <Upload size={28} className="text-accent" />
            <span className="text-[18px] font-semibold">Choose files or drop them here</span>
            <span className="text-[14px] text-muted">PDF, Word, Excel, CSV, photos or screenshots, email text. Up to {MAX_FILES} files, 4 MB each.</span>
          </button>
          <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} data-testid="plan-input" aria-label="Choose travel documents" />
        </>
      ) : null}

      {rows.length > 0 && (
        <Card className="space-y-2 p-3">
          <ul className="divide-y divide-line" data-testid="plan-files">
            {rows.map((r, i) => (
              <li key={`${r.file.name}-${i}`} className="flex items-center gap-3 py-2" data-testid="plan-file" data-state={r.state}>
                <FileText size={20} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.file.name}</span>
                  <span className="block text-[13px] text-muted">{size(r.file.size)}{r.note ? ` · ${r.note}` : r.state === "read" ? " · read" : r.state === "uploading" ? " · uploading…" : ""}</span>
                </span>
                {r.state === "uploading" ? <Loader2 size={18} className="animate-spin text-muted" /> : r.state === "read" ? <CheckCircle2 size={18} className="text-ok" /> : r.state === "skipped" || r.state === "error" ? <TriangleAlert size={18} className="text-warn" /> : null}
                {(phase === "pick" || phase === "error") && <button type="button" onClick={() => setRows((all) => all.filter((_, k) => k !== i))} aria-label={`Remove ${r.file.name}`} className="grid size-11 place-items-center rounded-full text-muted hover:text-ink"><X size={18} /></button>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {err && <p role="alert" className="rounded-xl border border-danger p-3 text-danger" data-testid="plan-error">{err}</p>}

      {(phase === "pick" || phase === "error") && (
        <>
          <Button variant="primary" size="lg" block disabled={!rows.some((r) => r.state !== "error")} onClick={build} data-testid="plan-build">{phase === "error" ? "Try again" : "Build my offline guide"}</Button>
          <p className="text-[13px] text-muted">Your files are read once to build the plan and are then deleted. Only the trip details (flights, hotels, places, times) are kept. Anything not written in your documents is left blank, never guessed.</p>
        </>
      )}

      {(phase === "working" || phase === "done") && (
        <Card className="space-y-3" data-testid="plan-progress">
          <ol className="space-y-2">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-3">{s.done ? <CheckCircle2 size={20} className="text-ok" /> : <Loader2 size={20} className="animate-spin text-accent" />}<span className="text-[16px]">{s.label}</span></li>
            ))}
          </ol>
          {phase === "working" && <p className="text-[14px] text-muted">This takes about a minute. Keep this page open.</p>}
        </Card>
      )}

      {phase === "done" && result && (
        <Card className="space-y-3 border-ok" data-testid="plan-done">
          <p className="flex items-center gap-2 text-[20px] font-semibold"><CheckCircle2 className="text-ok" /> Your trip is ready</p>
          <p className="text-[15px]">Trip <span className="font-mono">{result.ref}</span>. Open it once with internet and the offline guide, map and SOS are saved on this phone.</p>
          {result.warnings.length > 0 && (
            <div className="rounded-xl border border-warn p-3" data-testid="plan-warnings">
              <p className="mb-1 font-semibold">Please check</p>
              <ul className="list-disc space-y-1 pl-5 text-[15px]">{result.warnings.slice(0, 10).map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
          <LinkButton href={`/trips/${result.ref}?setup=1`} variant="primary" size="lg" block data-testid="plan-open">Open my trip</LinkButton>
        </Card>
      )}
      {phase === "error" && <p className="text-[14px] text-muted"><XCircle size={14} className="mr-1 inline" />Nothing was charged and no trip was created unless it says so above. <Link href="/trips" className="text-accent underline">My trips</Link></p>}
    </div>
  );
}
