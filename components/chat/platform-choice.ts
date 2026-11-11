"use client";
import { useEffect, useState } from "react";

/**
 * Which booking platform the traveller says they are logged in to (chosen at the top of the chat). Stored server-side via
 * /api/providers/connect (self-declared, no password or token involved) and broadcast on the page so every price card can
 * show "Pay on <platform>".
 */
export const PLATFORM_EVENT = "ss-platform";
let initial: Promise<string | null> | null = null;

export function fetchSelectedPlatform(): Promise<string | null> {
  initial ??= fetch("/api/providers/connect", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { connected?: string[] } | null) => j?.connected?.[0] ?? null)
    .catch(() => null);
  return initial;
}

export function broadcastPlatform(id: string | null) {
  initial = Promise.resolve(id);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PLATFORM_EVENT, { detail: id }));
}

export function useSelectedPlatform(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchSelectedPlatform().then((v) => { if (alive) setId((cur) => cur ?? v); });
    const on = (e: Event) => setId((e as CustomEvent<string | null>).detail ?? null);
    window.addEventListener(PLATFORM_EVENT, on);
    return () => { alive = false; window.removeEventListener(PLATFORM_EVENT, on); };
  }, []);
  return id;
}
