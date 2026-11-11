"use client";
import { CloudOff, Signal, Wifi } from "lucide-react";
import { useNetwork } from "@/lib/offline/network-state";

/** The network state is always visible: Online · Offline pack · Signal only. */
export function NetworkBadge({ className = "" }: { className?: string }) {
  const { status } = useNetwork();
  const cfg = {
    online: { label: "Online", icon: <Wifi size={16} strokeWidth={1.75} />, cls: "border-ok text-ok" },
    signal: { label: "Signal only", icon: <Signal size={16} strokeWidth={1.75} />, cls: "border-warn text-warn" },
    none: { label: "Offline pack", icon: <CloudOff size={16} strokeWidth={1.75} />, cls: "border-warn text-warn" },
  }[status];
  return (
    <span role="status" aria-live="polite" data-testid="net-badge" data-status={status} className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border bg-surface px-3 text-[13px] font-semibold ${cfg.cls} ${className}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}
