import type { OfflinePack, PackItem } from "@/lib/packs/types";
import { currentStay } from "@/lib/rules/context";
import { zonedToUtc } from "@/lib/time";

export type TimedItem = PackItem & { date: string; at: Date; cityName: string; tz: string; dayNo: number };

export function flatItems(pack: OfflinePack): TimedItem[] {
  return pack.days
    .flatMap((d) => d.items.map((i) => ({ ...i, date: d.date, tz: d.tz, cityName: d.cityName, dayNo: d.dayNo, at: zonedToUtc(d.date, i.time, d.tz) })))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function nextItem(pack: OfflinePack, now: Date): { item: TimedItem | null; status: "before" | "during" | "after" } {
  const all = flatItems(pack);
  const upcoming = all.find((i) => i.at.getTime() >= now.getTime() - 15 * 60_000);
  if (!all.length) return { item: null, status: "before" };
  if (!upcoming) return { item: null, status: "after" };
  return { item: upcoming, status: now < all[0].at ? "before" : "during" };
}

export function pickupItem(pack: OfflinePack, now: Date, cityOverride?: string) {
  const stay = currentStay(pack, now, cityOverride);
  const item = flatItems(pack).find((i) => i.type === "transfer" && /^Pickup/.test(i.title) && i.date === stay.from);
  return { stay, item };
}

export function relTime(to: Date, now: Date): string {
  const mins = Math.round((to.getTime() - now.getTime()) / 60000);
  const abs = Math.abs(mins);
  const txt = abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.floor(abs / 60)} h ${abs % 60 ? `${abs % 60} min` : ""}`.trim() : `${Math.round(abs / 1440)} days`;
  return mins >= 0 ? `in ${txt}` : `${txt} ago`;
}

export function ago(ts: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hour${Math.floor(s / 3600) > 1 ? "s" : ""} ago`;
  return `${Math.floor(s / 86400)} day${Math.floor(s / 86400) > 1 ? "s" : ""} ago`;
}

export const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
export const telHref = (p: string) => `tel:${p.replace(/[^+\d]/g, "")}`;
