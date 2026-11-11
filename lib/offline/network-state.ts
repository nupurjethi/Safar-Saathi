"use client";
import { useSyncExternalStore } from "react";

/**
 * Three states (spec 3.3):
 *  online  : heartbeat to /api/health succeeds
 *  signal  : heartbeat fails, the traveller says "I have signal" (cellular, no data) -> SMS SOS possible
 *  none    : heartbeat fails, no signal (airplane mode) -> offline pack only, SOS is queued
 */
export type NetStatus = "online" | "signal" | "none";
type S = { status: NetStatus; checkedAt: number; hasSignal: boolean };

let state: S = { status: "online", checkedAt: 0, hasSignal: false };
const SERVER_STATE: S = { status: "online", checkedAt: 0, hasSignal: false }; // must be a stable reference
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let started = false;

function set(next: Partial<S>) {
  const merged = { ...state, ...next };
  if (merged.status !== state.status || merged.hasSignal !== state.hasSignal) {
    state = merged;
    listeners.forEach((l) => l());
  } else state = merged;
}

async function beat() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return set({ status: state.hasSignal ? "signal" : "none", checkedAt: Date.now() });
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 2500);
  try {
    const r = await fetch(`/api/health?t=${Date.now()}`, { cache: "no-store", signal: ctl.signal });
    set({ status: r.ok ? "online" : state.hasSignal ? "signal" : "none", checkedAt: Date.now() });
  } catch {
    set({ status: state.hasSignal ? "signal" : "none", checkedAt: Date.now() });
  } finally {
    clearTimeout(to);
  }
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    state = { ...state, hasSignal: sessionStorage.getItem("ss-has-signal") === "1" };
  } catch {}
  void beat();
  timer = setInterval(beat, 3000); // 3-second heartbeat
  window.addEventListener("online", beat);
  window.addEventListener("offline", beat);
}

function subscribe(l: () => void) {
  listeners.add(l);
  start();
  return () => {
    listeners.delete(l);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
      started = false;
      window.removeEventListener("online", beat);
      window.removeEventListener("offline", beat);
    }
  };
}

/** The traveller confirms they have cellular signal (bars) but no data. */
export function setHasSignal(v: boolean) {
  try {
    sessionStorage.setItem("ss-has-signal", v ? "1" : "0");
  } catch {}
  set({ hasSignal: v, status: state.status === "online" ? "online" : v ? "signal" : "none" });
}

export function useNetwork(): S {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}
