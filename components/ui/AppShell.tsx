"use client";
import { Compass, FilePlus2, LogOut, Luggage, Moon, Shield, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { NetworkBadge } from "./NetworkBadge";
import { flushSos } from "@/lib/offline/outbox";
import { useNetwork } from "@/lib/offline/network-state";

type Me = { id: string; name: string; role: string } | null;

export function AppShell({ children, signedIn = false }: { children: React.ReactNode; signedIn?: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [theme, setTheme] = useState<"dark" | "light" | "system">("system");
  const { status } = useNetwork();
  const inTrip = /^\/trips\/SS-/.test(path);
  // The scroll story ("How it works") brings its own header, cursor and scroll. It is the landing page for visitors who are not signed in.
  const isStory = path === "/story" || (path === "/" && !signedIn);
  const tripsHref = signedIn ? "/" : "/explore";

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    try {
      const t = localStorage.getItem("ss-theme");
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}
  }, []);

  useEffect(() => {
    if (status !== "online") return;
    fetch("/api/me", { cache: "no-store" }).then((r) => r.json()).then((j) => setMe(j.user ?? null)).catch(() => setMe((m) => m ?? null));
    void flushSos().then((sent) => { if (sent.length) window.dispatchEvent(new CustomEvent("ss-sos-sent", { detail: sent })); });
  }, [status, path]);

  const toggleTheme = useCallback(() => {
    const dark = document.documentElement.getAttribute("data-theme") ? document.documentElement.getAttribute("data-theme") === "dark" : !window.matchMedia("(prefers-color-scheme: light)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("ss-theme", next); } catch {}
    setTheme(next);
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setMe(null);
    router.push("/");
    router.refresh(); // re-read the session on the server so "/" shows the visitor landing page
  };
  const staff = me && (me.role === "admin" || me.role === "agent");

  if (isStory) return <>{children}</>;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="no-print sticky top-0 z-40 px-3 pt-3 pt-safe sm:px-4 sm:pt-4">
        <div className="mx-auto flex max-w-6xl items-center gap-3 rounded-full border border-line bg-bg/70 py-2 pl-5 pr-2 backdrop-blur-xl">
          <Link href="/" className="inline-flex min-h-11 items-center font-display text-[20px] font-bold tracking-tight">
            safar<span className="text-accent">saathi</span>
          </Link>
          <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[12px] font-medium uppercase tracking-wide text-muted lg:inline-flex" title="All trips, prices, flights and hotels are sample data from our own mock travel API."><span aria-hidden className="size-1.5 rounded-full bg-lime" />Sample data · test payment</span>
          <nav aria-label="Primary" className="ml-4 hidden items-center gap-6 text-[14px] font-medium sm:flex [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center">
            <Link href={tripsHref} className={path === "/" || path.startsWith("/explore") || path.startsWith("/itinerary") ? "text-accent" : "text-ink hover:text-accent"}>Trips</Link>
            <Link href="/trips" className={path.startsWith("/trips") ? "text-accent" : "text-ink hover:text-accent"}>My trips</Link>
            {me && me.role === "traveller" && <Link href="/plans/new" className={path.startsWith("/plans") ? "text-accent" : "text-ink hover:text-accent"}>Add travel plan</Link>}
            {staff && <Link href="/agent" className={path.startsWith("/agent") ? "text-accent" : "text-ink hover:text-accent"}>Agent desk</Link>}
            {staff && <Link href="/admin/cases" className={path.startsWith("/admin") ? "text-accent" : "text-ink hover:text-accent"}>Admin</Link>}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <NetworkBadge />
            <button onClick={toggleTheme} aria-label={`Switch theme (now ${theme})`} className="grid size-10 place-items-center rounded-full border border-line bg-surface text-ink hover:border-muted">
              <Sun size={18} strokeWidth={1.75} className="hidden [:root[data-theme=dark]_&]:block" />
              <Moon size={18} strokeWidth={1.75} className="block [:root[data-theme=dark]_&]:hidden" />
            </button>
            {me && (
              <button onClick={logout} aria-label="Sign out" className="grid size-10 place-items-center rounded-full border border-line bg-surface text-ink hover:border-muted"><LogOut size={18} strokeWidth={1.75} /></button>
            )}
          </div>
        </div>
      </header>
      <div className="no-print px-4 pt-2 text-center text-[12px] font-medium uppercase tracking-wide text-muted sm:hidden">Sample data · test payment, no money moves</div>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 sm:pb-12">{children}</main>

      {!inTrip && (
        <nav aria-label="Main" className="no-print fixed inset-x-3 bottom-3 z-40 rounded-full border border-line bg-bg/85 pb-safe backdrop-blur-xl sm:static sm:border-0 sm:bg-transparent sm:pb-0">
          <ul className="mx-auto flex max-w-md items-stretch justify-around sm:hidden">
            <NavItem href={tripsHref} icon={<Compass size={22} strokeWidth={1.75} />} label="Trips" active={path === "/" || path.startsWith("/explore") || path.startsWith("/itinerary")} />
            <NavItem href="/trips" icon={<Luggage size={22} strokeWidth={1.75} />} label="My Trips" active={path.startsWith("/trips")} />
            {me && me.role === "traveller" && <NavItem href="/plans/new" icon={<FilePlus2 size={22} strokeWidth={1.75} />} label="Add plan" active={path.startsWith("/plans")} />}
            {staff && <NavItem href="/agent" icon={<Shield size={22} strokeWidth={1.75} />} label="Agent desk" active={path.startsWith("/agent") || path.startsWith("/admin")} />}
          </ul>
        </nav>
      )}
    </div>
  );
}

function NavItem({ href, icon, label, active }: { href: string; icon: React.ReactNode; label: string; active: boolean }) {
  return (
    <li className="flex-1">
      <Link href={href} aria-current={active ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[13px] font-medium ${active ? "text-accent" : "text-muted"}`}>
        {icon}
        {label}
      </Link>
    </li>
  );
}
