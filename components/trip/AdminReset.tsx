"use client";
import { useState } from "react";
import { Button, Card } from "@/components/ui/primitives";

export function AdminReset() {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!confirm("Delete all bookings, chats, cases and offline packs, then recreate Neha's demo trip?")) return;
    setBusy(true); setMsg(null);
    const r = await fetch("/api/admin/reset", { method: "POST" });
    const j = await r.json();
    setBusy(false);
    setMsg(r.ok ? `Done. ${j.ref} recreated (pack v${j.packVersion}). Sign in again as Neha.` : j.message);
  };
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-[32px] font-bold leading-tight">Reset demo data</h1>
      <Card className="space-y-3"><p>Clears bookings, agent history, action logs, cases, SMS and offline packs. The 100+ sample itineraries stay. Recreates Neha&apos;s Paris to Rome trip for 4.</p><Button variant="danger" size="lg" onClick={run} disabled={busy}>{busy ? "Resetting…" : "Reset demo data"}</Button>{msg && <p role="status">{msg}</p>}</Card>
    </div>
  );
}
