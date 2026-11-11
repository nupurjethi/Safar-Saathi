"use client";
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, Card } from "@/components/ui/primitives";

const field = "mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-line bg-surface-2 px-3 text-[16px] text-ink";
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function Login() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") ?? "/trips";
  const agentMode = sp.get("role") === "agent";
  const [mode, setMode] = useState<"signin" | "create">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<{ stub: boolean; devCode?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const done = (to: string) => { router.push(to); router.refresh(); };
  const demo = async (role: "traveller" | "agent" | "admin") => {
    setBusy(true); setErr(null);
    const r = await post("/api/auth/demo", { role });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.message ?? "Demo login failed."); setBusy(false); return; }
    done(role === "traveller" ? next : role === "agent" ? "/agent" : "/admin/cases");
  };
  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await post(mode === "create" ? "/api/auth/register" : "/api/auth/login", mode === "create" ? { name, email, password } : { email, password });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.message ?? "Could not sign you in."); setBusy(false); return; }
      done(next);
    } catch { setErr("No connection. Signing in needs data."); setBusy(false); }
  };
  const request = async () => {
    setBusy(true); setErr(null);
    const r = await post("/api/auth/otp/request", { email });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.message ?? "Could not send a code.");
    setSent(j);
  };
  const verify = async () => {
    setBusy(true); setErr(null);
    const r = await post("/api/auth/otp/verify", { email, code });
    const j = await r.json();
    if (!r.ok) { setBusy(false); return setErr(j.message ?? "That code did not work."); }
    done(next);
  };

  if (agentMode) {
    return (
      <div className="mx-auto max-w-md space-y-5">
        <h1 className="text-[32px] font-bold leading-tight">Agent login</h1>
        <Card className="space-y-3">
          <p className="text-muted">The agent desk shows emergency alerts from SOS taps, texts to the helpline and help requests, as they arrive.</p>
          <Button variant="primary" size="lg" block disabled={busy} onClick={() => demo("agent")} data-testid="demo-agent-login">Continue as Asha (demo agent)</Button>
          <Button size="md" block disabled={busy} onClick={() => demo("admin")}>Continue as Admin (demo)</Button>
          <p className="text-[14px] text-muted">Demo accounts, sample data. Real staff sign-in needs staff accounts and an email key (not set up yet).</p>
        </Card>
        {err && <p role="alert" className="text-danger">{err}</p>}
        <p className="text-[15px]"><Link href="/login?role=traveller" className="inline-flex min-h-11 items-center text-accent underline">I am a travel user</Link></p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-5">
      <h1 className="text-[32px] font-bold leading-tight">Travel user login</h1>

      <Card className="space-y-3">
        <h2 className="text-[20px] font-semibold">Demo account</h2>
        <p className="text-muted">Opens straight into Neha&apos;s Paris to Rome trip for 4 travellers. Sample data.</p>
        <Button variant="primary" size="lg" block disabled={busy} onClick={() => demo("traveller")} data-testid="demo-login">Continue as Neha (demo)</Button>
      </Card>

      <Card className="space-y-4">
        <div role="tablist" aria-label="Email and password" className="grid grid-cols-2 gap-1 rounded-full border border-line bg-surface-2 p-1">
          {([["signin", "Sign in"], ["create", "Create account"]] as const).map(([m, label]) => (
            <button key={m} role="tab" type="button" aria-selected={mode === m} onClick={() => { setMode(m); setErr(null); }} data-testid={`tab-${m}`} className={`min-h-11 rounded-full text-[15px] font-semibold ${mode === m ? "bg-lime text-lime-ink" : "text-muted"}`}>{label}</button>
          ))}
        </div>
        <form onSubmit={submitPassword} className="space-y-3" data-testid="password-form">
          {mode === "create" && (
            <label className="block text-[15px] text-muted">Your name<input required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={field} data-testid="pw-name" /></label>
          )}
          <label className="block text-[15px] text-muted">Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" autoCapitalize="none" className={field} data-testid="pw-email" /></label>
          <label className="block text-[15px] text-muted">Password
            <span className="relative block">
              <input required type={show ? "text" : "password"} minLength={mode === "create" ? 8 : 1} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "create" ? "new-password" : "current-password"} className={`${field} pr-12`} data-testid="pw-password" />
              <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} className="absolute right-1 top-2 grid size-11 place-items-center rounded-full text-muted hover:text-ink">{show ? <EyeOff size={20} /> : <Eye size={20} />}</button>
            </span>
          </label>
          {mode === "create" && <p className="text-[13px] text-muted">At least 8 characters. We store only a salted hash, never the password itself.</p>}
          {err && <p role="alert" className="text-danger" data-testid="login-error">{err}</p>}
          <Button type="submit" size="lg" block variant="primary" disabled={busy} data-testid="pw-submit">{busy ? "Please wait…" : mode === "create" ? "Create account" : "Sign in"}</Button>
        </form>
      </Card>

      <details className="card p-4">
        <summary className="flex min-h-11 cursor-pointer items-center text-[17px] font-semibold">Sign in with an email code instead</summary>
        <div className="mt-3 space-y-3">
          {!sent ? (
            <>
              <label className="block text-[15px] text-muted">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={field} /></label>
              <Button size="lg" block disabled={busy || !email.includes("@")} onClick={request}>Send me a code</Button>
            </>
          ) : (
            <>
              {sent.stub && <p className="rounded-xl border border-warn p-3 text-[15px]">No email key is set yet (STUB). The code is in the server log{sent.devCode ? <>, and for local development here: <span className="font-mono font-bold">{sent.devCode}</span></> : ""}.</p>}
              <label className="block text-[15px] text-muted">6-digit code<input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={`${field} font-mono text-[22px] tracking-widest`} /></label>
              <Button size="lg" block variant="primary" disabled={busy || code.length !== 6} onClick={verify}>Sign in</Button>
            </>
          )}
        </div>
      </details>

      <p className="text-[15px]"><Link href="/login?role=agent" className="inline-flex min-h-11 items-center text-accent underline">I am an agent</Link></p>
    </div>
  );
}
