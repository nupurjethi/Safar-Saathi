"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, Card } from "@/components/ui/primitives";

export function Login() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") ?? "/trips";
  const agentMode = sp.get("role") === "agent";
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<{ stub: boolean; devCode?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const demo = async (role: "traveller" | "agent" | "admin") => {
    setBusy(true); setErr(null);
    const r = await fetch("/api/auth/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.message ?? "Demo login failed."); setBusy(false); return; }
    router.push(role === "traveller" ? next : role === "agent" ? "/agent" : "/admin/cases");
    router.refresh();
  };
  const request = async () => {
    setBusy(true); setErr(null);
    const r = await fetch("/api/auth/otp/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.message ?? "Could not send a code.");
    setSent(j);
  };
  const verify = async () => {
    setBusy(true); setErr(null);
    const r = await fetch("/api/auth/otp/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code }) });
    const j = await r.json();
    if (!r.ok) { setBusy(false); return setErr(j.message ?? "That code did not work."); }
    router.push(next); router.refresh();
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
      <Card className="space-y-3">
        <h2 className="text-[20px] font-semibold">Email code</h2>
        {!sent ? (
          <>
            <label className="block text-[15px] text-muted">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-line bg-surface-2 px-3 text-[17px] text-ink" /></label>
            <Button size="lg" block disabled={busy || !email.includes("@")} onClick={request}>Send me a code</Button>
          </>
        ) : (
          <>
            {sent.stub && <p className="rounded-xl border border-warn p-3 text-[15px]">No email key is set yet (STUB). The code is in the server log{sent.devCode ? <>, and for local development here: <span className="font-mono font-bold">{sent.devCode}</span></> : ""}.</p>}
            <label className="block text-[15px] text-muted">6-digit code<input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-line bg-surface-2 px-3 font-mono text-[22px] tracking-widest text-ink" /></label>
            <Button size="lg" block variant="primary" disabled={busy || code.length !== 6} onClick={verify}>Sign in</Button>
          </>
        )}
      </Card>
      {err && <p role="alert" className="text-danger">{err}</p>}
      <p className="text-[15px]"><Link href="/login?role=agent" className="inline-flex min-h-11 items-center text-accent underline">I am an agent</Link></p>
    </div>
  );
}
