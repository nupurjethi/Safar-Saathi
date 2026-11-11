"use client";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./primitives";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: BIPEvent | null = null;
const subs = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BIPEvent;
    subs.forEach((s) => s());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    subs.forEach((s) => s());
  });
}

export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  const standalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
  const ios = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  return {
    canInstall: !!deferred, standalone, ios,
    install: async () => {
      if (!deferred) return;
      await deferred.prompt();
      void fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "install_prompt" }) }).catch(() => {});
      deferred = null;
      subs.forEach((s) => s());
    },
  };
}

export function InstallPrompt({ compact }: { compact?: boolean }) {
  const { canInstall, standalone, ios, install } = useInstall();
  if (standalone) return <p className="text-muted">Installed. Safar Saathi opens like an app.</p>;
  if (canInstall) return <Button variant={compact ? "secondary" : "primary"} onClick={install}><Download size={18} strokeWidth={1.75} /> Install the app</Button>;
  if (ios) return <p className="text-muted">On iPhone: tap Share, then Add to Home Screen. This keeps your offline guide on your phone.</p>;
  return <p className="text-muted">To install: use your browser menu, then Install app or Add to Home Screen.</p>;
}
