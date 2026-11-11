"use client";
import "./story.css";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { initialState, Stage, type CardData } from "@/lib/story/stage";
import { Cursor, LogoMark, Marquee, MonoLink, Scramble } from "./parts";

export type Featured = { slug: string; title: string; sub: string; price: string; palette: [string, string]; cities: string[]; blurb: string; image?: { src: string; credit: string; sourceUrl: string; title: string } };

const HERO_LINES = ["Booked by you.", "Guided by AI.", "Ready when the signal drops."];
const CAROUSEL = ["Offline pack ready in <30 s", "Changes only when you confirm", "SOS that reaches a person", "One trip, one agent, one pack", "Honest sample data, labelled"];
const CAPS = [
  { t: "Human-led booking", b: "Choose from 100+ sample itineraries and pay with a test payment. Flights, hotels, transfers and activities are laid out day by day, in plain words.", pills: ["100+ itineraries", "Day-by-day plan", "Test payment", "Voucher"] },
  { t: "An agent that asks first", b: "Ask about your pickup or move a flight. The AI quotes the change, shows a review card and waits. Only your Confirm tap can book it, and the server enforces that.", pills: ["Review card", "Confirm token", "Price re-check", "Action log"] },
  { t: "An offline pack in your pocket", b: "Your plan, contacts, six step-by-step help guides and local-script address cards are saved on your phone. They work with no mobile data.", pills: ["Day plan", "6 help guides", "Address cards", "Contacts"] },
  { t: "Map, GPS and SOS", b: "A saved map and routes show a blue dot using only GPS. With signal but no data, SOS opens a prefilled text. Online, it pages a person on our team.", pills: ["Offline map", "GPS dot", "Off-route hint", "SMS SOS"] },
];
const PILL_POS = [["left-[2%] top-[18%]", "right-[4%] top-[12%]", "left-[0%] bottom-[24%]", "right-[6%] bottom-[16%]"], ["left-[4%] top-[14%]", "right-[0%] top-[20%]", "left-[2%] bottom-[20%]", "right-[8%] bottom-[12%]"], ["left-[0%] top-[22%]", "right-[6%] top-[10%]", "left-[6%] bottom-[16%]", "right-[2%] bottom-[24%]"], ["left-[6%] top-[12%]", "right-[2%] top-[22%]", "left-[0%] bottom-[22%]", "right-[4%] bottom-[14%]"]];
const STATS: [string, string, string][] = [["113", "Sample itineraries", "to browse and book today"], ["26", "Destinations", "across Europe, Asia and beyond"], ["6", "Offline help guides", "that need no mobile data"], ["60s", "Target to reach a person", "on a severity-1 SOS"]];
const WHY = [
  ["Confirm-first, not auto-book", "We didn't bolt AI onto a booking flow. The server cannot apply a change without your tap."],
  ["Offline from the first tap", "Your plan, map and help are saved on your phone before you fly."],
  ["Honest by design", "Sample data is labelled. Offline guidance never pretends to be live."],
  ["Help that reaches a person", "SOS opens a case for a human, online or by SMS."],
];
const MOMENTS = [
  "It is our first trip abroad, and nobody tells you what happens after you pay.",
  "The flight moved. I just wanted to change it without waiting on hold.",
  "My data ran out in a taxi at night, and the address was only in a PDF.",
  "I lost my passport and needed to know what to do first, in plain words.",
  "I wanted to be sure nothing got booked unless I said yes.",
];

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function Story({ featured }: { featured: Featured[] }) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [lite, setLite] = useState(false);
  const [svc, setSvc] = useState(0);
  const [workIdx, setWorkIdx] = useState(0);
  const [menu, setMenu] = useState(false);
  const [navDark, setNavDark] = useState(false);

  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const gl = (() => { try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; } })();
    if (reduce || !gl) { setLite(true); setReady(true); return; }

    gsap.registerPlugin(ScrollTrigger);
    const lenis = new Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 0.95 });
    lenis.on("scroll", ScrollTrigger.update);
    // header flips to dark ink while it sits over a light section
    const lightSel = ["#how", "#why", "#moments"];
    const updateNav = () => {
      const over = lightSel.some((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return !!r && r.top < 40 && r.bottom > 40; });
      const hp = stage?.state.hero ?? 0;
      const heroEnd = flags.hero && hp > 0.9;
      const workEnd = flags.work && (stage?.state.work ?? 0) > 0.965;
      setNavDark((cur) => (cur === (over || heroEnd || workEnd) ? cur : over || heroEnd || workEnd));
    };
    lenis.on("scroll", updateNav);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    let stage: Stage | null = null;
    let disposed = false;
    const flags = { hero: false, services: false, work: false, cta: false };
    const applyActive = () => { if (stage) stage.state.active = flags.cta ? "cta" : flags.work ? "work" : flags.services ? "services" : flags.hero ? "hero" : "none"; };

    const rootEl = root.current as (HTMLElement & { _cleanup?: () => void }) | null;
    const onPointer = (e: PointerEvent) => { if (stage) { stage.state.pointer.x = (e.clientX / innerWidth) * 2 - 1; stage.state.pointer.y = (e.clientY / innerHeight) * 2 - 1; } };
    addEventListener("pointermove", onPointer, { passive: true });

    const cards: CardData[] = featured.map((f) => ({ title: f.title, sub: f.sub, price: f.price, palette: f.palette, cities: f.cities, image: f.image ? { src: f.image.src, credit: f.image.credit } : undefined }));
    const labels = [...new Set([...featured.flatMap((f) => f.cities), "Paris", "Rome", "Dubai", "Bali", "Tokyo", "Singapore", "Maldives", "Istanbul", "Zurich"])];

    let ctx: gsap.Context | null = null;
    (async () => {
      await document.fonts.ready;
      if (disposed || !canvas.current || !root.current) return;
      stage = new Stage(canvas.current, cards, labels);
      stage.state = initialState();
      stage.onWorkIndex = (i) => setWorkIdx(i);
      const fit = () => stage!.resize(innerWidth, innerHeight, devicePixelRatio || 1);
      fit(); addEventListener("resize", fit);
      const frame = (time: number, dt: number) => stage!.frame(time / 1000, Math.min(0.05, dt / 1000));
      gsap.ticker.add(frame);
      (root.current as HTMLElement & { _cleanup?: () => void })._cleanup = () => { removeEventListener("resize", fit); gsap.ticker.remove(frame); };

      ctx = gsap.context(() => {
        const q = (s: string) => root.current!.querySelector(s) as HTMLElement;
        const qa = (s: string) => gsap.utils.toArray<HTMLElement>(root.current!.querySelectorAll(s));
        const mm = gsap.matchMedia();
        mm.add({ desk: "(min-width: 768px)", mob: "(max-width: 767px)" }, (c) => {
          const mob = !!c.conditions?.mob;

          /* ---------------- HERO: the plane pre-flight → take-off → dive into the glow ---------------- */
          const heads = qa(".st-h1");
          const lines = qa(".st-carousel .st-line");
          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: q("#top"), start: "top top", end: mob ? "+=380%" : "+=560%", scrub: true, pin: true, anticipatePin: 1,
              onUpdate: (self) => {
                if (!stage) return;
                stage.state.hero = self.progress;
                const idx = Math.min(4.99, Math.max(0, (self.progress - 0.54) / 0.062));
                lines.forEach((el, i) => {
                  const d = i - idx; const a = Math.abs(d);
                  const on = self.progress > 0.52 && self.progress < 0.84;
                  gsap.set(el, { opacity: on ? Math.max(0, 1 - a * 0.72) * (a < 0.5 ? 1 : 0.55) : 0, yPercent: d * 120, scale: 1 - Math.min(0.25, a * 0.1), filter: `blur(${Math.min(6, a * 3)}px)` });
                });
              },
              onToggle: (self) => { flags.hero = self.isActive; applyActive(); },
            },
          });
          heads.forEach((h, i) => {
            if (i > 0) tl.fromTo(h, { opacity: 0, filter: "blur(16px)", yPercent: 28 }, { opacity: 1, filter: "blur(0px)", yPercent: 0, duration: 0.06 }, 0.14 + (i - 1) * 0.17);
            if (i < heads.length) tl.to(h, { opacity: 0, filter: "blur(16px)", yPercent: -24, duration: 0.06 }, 0.11 + i * 0.17 + (i === 2 ? 0.0 : 0));
          });
          tl.to(".st-hero-label", { opacity: 0, duration: 0.05 }, 0.5);
          tl.to(".st-hero-corner", { opacity: 0, y: 30, duration: 0.06 }, 0.42);
          tl.fromTo(".st-flight", { opacity: 0, yPercent: 8 }, { opacity: 1, yPercent: -6, duration: 0.2 }, 0.38);
          tl.to(".st-flight", { opacity: 0, duration: 0.1 }, 0.86);
          tl.fromTo(".st-carousel-label", { opacity: 0 }, { opacity: 1, duration: 0.06 }, 0.52);
          tl.to(".st-carousel-label", { opacity: 0, duration: 0.05 }, 0.84);
          tl.to(".st-hero-glow", { opacity: 1, duration: 0.12 }, 0.46);
          tl.to(".st-hero-glow", { scaleY: 3.6, scaleX: 1.5, duration: 0.34, ease: "power2.in" }, 0.55);
          tl.to(".st-hero-top", { opacity: 0, duration: 0.1 }, 0.5);
          tl.to(".st-hero-bg", { opacity: 1, duration: 0.1 }, 0.9);
          tl.fromTo(".st-quote", { opacity: 0, y: 40, filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.07 }, 0.9);
          tl.to({}, { duration: 0.0001 }, 1);

          /* ---------------- WHAT WE DO: pinned capabilities + morphing banded ring ---------------- */
          ScrollTrigger.create({
            trigger: q("#svc-pin"), start: "top top", end: mob ? "+=320%" : "+=420%", pin: true, anticipatePin: 1,
            onUpdate: (self) => {
              if (!stage) return;
              const f = Math.min(3, Math.max(0, self.progress * 4 - 0.5));
              stage.state.services = self.progress; stage.state.serviceIndex = f;
              const idx = Math.min(3, Math.floor(self.progress * 4));
              setSvc((cur) => (cur === idx ? cur : idx));
            },
            onToggle: (self) => { flags.services = self.isActive; applyActive(); },
          });
          gsap.fromTo(".st-marquee-scrub", { xPercent: 4 }, { xPercent: -34, ease: "none", scrollTrigger: { trigger: ".st-band", start: "top bottom", end: "bottom top", scrub: true } });

          /* ---------------- WORK: plane rises, trips slide out of the cabin door ---------------- */
          const wtl = gsap.timeline({
            scrollTrigger: {
              trigger: q("#work"), start: "top top", end: mob ? "+=700%" : "+=900%", scrub: true, pin: true, anticipatePin: 1,
              onUpdate: (self) => {
                if (!stage) return;
                stage.state.work = self.progress;
                const r = smooth(0.84, 0.94, self.progress) * (1 - smooth(0.975, 1, self.progress));
                qa(".st-stat").forEach((el, i) => {
                  const sx = i % 2 ? 1 : -1, sy = i < 2 ? -1 : 1;
                  gsap.set(el, { opacity: r, x: sx * (1 - r) * innerWidth * 0.35, y: sy * (1 - r) * innerHeight * 0.3, scale: 0.86 + 0.14 * r });
                });
              },
              onToggle: (self) => { flags.work = self.isActive; applyActive(); },
            },
          });
          wtl.fromTo(".st-work-left", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.07 }, 0.1);
          wtl.fromTo(".st-work-right", { opacity: 0 }, { opacity: 1, duration: 0.06 }, 0.2);
          wtl.to([".st-work-left", ".st-work-right"], { opacity: 0, duration: 0.05 }, 0.8);
          wtl.fromTo(".st-work-glow", { opacity: 0, yPercent: 40 }, { opacity: 1, yPercent: 0, duration: 0.15 }, 0.76);
          wtl.to(".st-work-glow", { scaleY: 3, duration: 0.14, ease: "power2.in" }, 0.9);
          wtl.to(".st-work-bg", { opacity: 1, duration: 0.05 }, 0.96);
          wtl.to({}, { duration: 0.0001 }, 1);

          /* ---------------- WHY: tile connects to its siblings ---------------- */
          const wh = gsap.timeline({ scrollTrigger: { trigger: q("#why"), start: "top top", end: mob ? "+=220%" : "+=280%", scrub: true, pin: true, anticipatePin: 1 } });
          wh.fromTo(".why-t1", { scale: 0.82, opacity: 0, y: 40 }, { scale: 1, opacity: 1, y: 0, duration: 0.2 }, 0);
          wh.to(".why-t1", { xPercent: mob ? 0 : -8, duration: 0.3 }, 0.32);
          wh.fromTo(".why-line", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.25 }, 0.4);
          wh.fromTo(".why-t2", { opacity: 0, x: 60 }, { opacity: 1, x: 0, duration: 0.18 }, 0.5);
          wh.fromTo(".why-t3", { opacity: 0, x: 60 }, { opacity: 1, x: 0, duration: 0.18 }, 0.62);
          wh.fromTo(".why-list", { opacity: 0, x: 40 }, { opacity: 1, x: 0, duration: 0.2 }, 0.7);
          wh.to({}, { duration: 0.0001 }, 1);

          /* ---------------- CTA ---------------- */
          ScrollTrigger.create({
            trigger: q("#cta"), start: "top bottom", end: "bottom bottom",
            // isActive turns false at progress === 1, which is exactly where the page ends, so track it by progress
            onUpdate: (self) => { if (stage) stage.state.cta = self.progress; const on = self.progress > 0; if (flags.cta !== on) { flags.cta = on; applyActive(); } },
          });

          /* reveals */
          qa("[data-reveal]").forEach((el) => gsap.from(el, { opacity: 0, y: 36, filter: "blur(8px)", duration: 1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%" } }));
        });
      }, root);

      ScrollTrigger.refresh();
      setReady(true);
    })();

    return () => {
      disposed = true;
      removeEventListener("pointermove", onPointer);
      rootEl?._cleanup?.();
      ctx?.revert();
      gsap.ticker.remove(tick);
      lenis.destroy();
      ScrollTrigger.getAll().forEach((s) => s.kill());
      stage?.dispose();
    };
  }, [featured]);

  const f = featured[Math.min(workIdx, featured.length - 1)];

  return (
    <div ref={root} className={`st-root ${lite ? "st-lite" : ""}`}>
      {/* loader */}
      <div aria-hidden={ready} className={`fixed inset-0 z-[100] grid place-items-center bg-[#050505] transition-opacity duration-700 ${ready ? "pointer-events-none opacity-0" : "opacity-100"}`}>
        <div className="st-mono text-center text-[12px] uppercase leading-relaxed text-white/60">Smoothing out first trips<br /><span className="text-[#d8fd34]">Boarding…</span></div>
      </div>
      <Cursor />

      {/* nav */}
      <header className="fixed inset-x-0 top-3 z-50 px-3 md:top-4 md:px-4">
        <div className={`mx-auto flex h-14 max-w-5xl items-center justify-between rounded-full border pl-5 pr-2 backdrop-blur-xl transition-colors duration-300 ${navDark ? "border-black/15 bg-white/70 text-[#050505]" : "border-white/12 bg-black/55 text-white"}`}>
          <Link href="/" className="flex items-center gap-2" aria-label="Safar Saathi home" data-cursor="link">
            <span className="text-[22px] font-semibold tracking-[-0.04em]">safar<span className={navDark ? "text-[#4f6b00]" : "text-[#d8fd34]"}>saathi</span></span><LogoMark className="h-6 w-9" />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-7 text-[14px] font-medium md:flex">
            <Link href="/" data-cursor="link" className={navDark ? "text-[#4f6b00]" : "text-[#d8fd34]"}>Trips</Link>
            <a href="#how" data-cursor="link">How it works</a>
            <Link href="/trips" data-cursor="link">My trips</Link>
            <Link href="/api/auth/demo?next=/trips" prefetch={false} data-cursor="link" className="rounded-full bg-[#d8fd34] px-5 py-2.5 text-[14px] font-bold text-[#050505] transition hover:brightness-95">Demo: open Neha&apos;s trip</Link>
          </nav>
          <button className="grid size-11 place-items-center md:hidden" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><span className={`block h-px w-7 ${navDark ? "bg-[#050505] shadow-[0_8px_0_#050505]" : "bg-white shadow-[0_8px_0_#fff]"}`} /></button>
        </div>
        {menu && (
          <nav className="mx-auto mt-2 flex max-w-5xl flex-col gap-4 rounded-3xl border border-white/12 bg-black/85 px-6 pb-6 pt-5 text-[18px] font-medium text-white backdrop-blur-xl md:hidden">
            <Link href="/" onClick={() => setMenu(false)}>Trips</Link><a href="#how" onClick={() => setMenu(false)}>How it works</a><Link href="/trips">My trips</Link><Link href="/api/auth/demo?next=/trips" prefetch={false} className="font-bold text-[#d8fd34]">Demo: open Neha&apos;s trip</Link>
          </nav>
        )}
      </header>

      <canvas ref={canvas} aria-hidden className="pointer-events-none fixed inset-0 z-20 h-full w-full" />

      {/* stats cards sit above the 3D plane (fixed layer) */}
      <div aria-hidden={!lite} className="pointer-events-none fixed inset-0 z-30 grid place-items-center">
        <div className="grid w-[min(940px,90vw)] grid-cols-2 gap-4 md:gap-6">
          {STATS.map(([n, t, s]) => (
            <div key={t} className="st-stat flex aspect-[1.55/1] flex-col justify-between p-5 opacity-0 md:p-8" style={lite ? { opacity: 1 } : undefined}>
              <div className="font-[family-name:var(--font-inter)] text-[clamp(40px,6.4vw,92px)] leading-none tracking-[-0.035em]">{n}</div>
              <div className="self-end text-right text-[13px] leading-snug md:text-[16px]"><b className="block font-medium">{t}</b>{s}</div>
            </div>
          ))}
        </div>
      </div>

      {/* =========================== HERO =========================== */}
      <section id="top" className="st-hero">
        <div className="st-hero-bg absolute inset-0 bg-[#f4f4ee] opacity-0" />
        <div className="st-hero-top" />
        <div className="st-hero-glow" />
        <svg className="st-flight" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden>
          <path d="M-20 300 C 260 150, 420 450, 720 330 S 1180 120, 1480 260" />
          <path d="M-20 560 C 300 400, 520 720, 860 560 S 1220 400, 1480 520" />
          <path d="M-20 130 C 240 40, 520 230, 800 120 S 1200 40, 1480 110" />
        </svg>

        <div className="st-hero-label st-mono absolute inset-x-0 top-[15%] text-center text-[12px] uppercase leading-snug text-white/45"><span>Smoothing out first trips</span><br /><span className="text-white/80">Since ⟶ 2026</span></div>

        <div className="absolute inset-x-0 top-[22%] h-[16vw] min-h-[90px]">
          {HERO_LINES.map((t, i) => (
            <h1 key={t} className="st-h1 st-line text-[#e8e8e8]" style={{ opacity: i === 0 ? 1 : lite ? 1 : 0 }} {...(i ? { "aria-hidden": lite ? undefined : true } : {})}>{t}</h1>
          ))}
        </div>

        <div className="st-carousel pointer-events-none absolute inset-0">
          <div className="st-carousel-label st-mono absolute inset-x-0 top-[15%] text-center text-[12px] uppercase text-white/45 opacity-0">Built for first flights</div>
          {CAROUSEL.map((t) => (<div key={t} className="st-line text-white" style={{ opacity: lite ? 1 : 0 }}>{t}</div>))}
        </div>

        <div className="st-hero-corner st-mono absolute bottom-[7%] left-[36px] max-md:left-5 max-md:bottom-[16%]">
          <p className="mb-1 text-[11px] uppercase text-white/45">AI stack</p>
          <Marquee items={["Claude", "OpenAI", "OpenRouter"]} className="w-[210px] text-[12px] uppercase text-white/85" speed={22} />
          <div className="mt-6 flex gap-6 text-[#d8fd34]">
            <MonoLink href="/">Start your trip</MonoLink>
            <MonoLink href="/api/auth/demo?next=/trips" prefetch={false} className="!text-white/85">See the demo</MonoLink>
          </div>
        </div>
        <div className="st-hero-corner absolute bottom-[7%] right-[36px] w-[min(300px,40vw)] max-md:hidden">
          <p className="st-mono mb-2 text-[11px] uppercase text-white/45">No surprises. No shortcuts.</p>
          <p className="text-[15px] leading-snug text-white/90">Safar Saathi pairs a human-first booking flow with an AI agent and an offline pack, so first-time travellers from India are never stuck after they pay.</p>
        </div>

        <div className="st-quote" style={lite ? { opacity: 1, position: "relative", marginTop: 60 } : { opacity: 0 }}>
          <div>
            <p className="text-[clamp(26px,4vw,58px)] leading-[1.05] tracking-[-0.03em]">An app can plan the change.<br />Only you can confirm it.</p>
            <p className="st-mono mt-8 text-[11px] uppercase opacity-70">Safar Saathi — no one left stranded</p>
          </div>
        </div>
      </section>

      {/* =========================== WHAT WE DO =========================== */}
      <section id="how" className="st-light relative">
        <div className="st-container grid grid-cols-12 gap-6 pb-10 pt-24 md:pt-32">
          <div className="col-span-12 md:col-span-7" data-reveal>
            <p className="st-mono mb-6 text-[11px] uppercase opacity-70">What we do</p>
            <h2 className="text-[clamp(44px,6vw,84px)]">Four capabilities.<br />One companion.</h2>
          </div>
          <p data-reveal className="col-span-12 self-end text-[15px] leading-snug opacity-80 md:col-span-3 md:col-start-9">Support shouldn&apos;t end at payment. Every part of Safar Saathi is built to work together, so when plans change or the network drops, you already have what you need.</p>
        </div>
        <div id="svc-pin" className="relative h-[100svh] max-md:h-auto max-md:pb-16">
          <div className="st-container grid h-full grid-cols-12 items-center gap-6 max-md:block">
            <div className="relative col-span-12 h-[68svh] md:col-span-6 max-md:h-[44svh]" aria-hidden>
              {/* the banded ring is drawn by the shared WebGL stage; these are its floating labels */}
              {CAPS[svc].pills.map((p, i) => (
                <span key={`${svc}-${p}`} className={`st-pill absolute ${PILL_POS[svc][i]}`} style={{ animation: "st-pill-in .6s both", animationDelay: `${i * 90}ms` }}>{p}</span>
              ))}
            </div>
            <ol className="col-span-12 md:col-span-5 md:col-start-8" aria-label="Capabilities">
              {CAPS.map((c, i) => (
                <li key={c.t} className="st-acc-item py-5" data-active={svc === i}>
                  <div className="flex items-center gap-4">
                    <span className={`st-mono grid size-6 shrink-0 place-items-center rounded-full text-[11px] ${svc === i ? "bg-[#050505] text-white" : "border border-[#050505]/40"}`}>{i + 1}</span>
                    <h3 className={`text-[clamp(26px,3.2vw,44px)] tracking-[-0.03em] transition-opacity duration-500 ${svc === i ? "opacity-100" : "opacity-55"}`}>{c.t}</h3>
                  </div>
                  <div className={`st-acc-body grid transition-[grid-template-rows,opacity] duration-500 ${svc === i || lite ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                    <p className="overflow-hidden pl-10 pt-3 text-[14px] leading-snug opacity-80">{c.b}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* =========================== BAND =========================== */}
      <div className="st-band overflow-hidden bg-[#050505] py-12" aria-hidden>
        <div className="st-marquee-scrub flex w-max gap-12 whitespace-nowrap text-[clamp(60px,11vw,170px)] uppercase leading-none tracking-[-0.03em] text-[#e8e8e8]">
          {Array.from({ length: 3 }, (_, i) => (<span key={i}>— Trips we&apos;re ready for</span>))}
        </div>
      </div>

      {/* =========================== WORK =========================== */}
      <section id="work" className="st-work relative h-[100svh] overflow-hidden max-md:min-h-[100svh]">
        <div className="st-work-bg absolute inset-0 bg-[#f4f4ee] opacity-0" />
        <div className="st-work-glow pointer-events-none absolute inset-x-[-10%] bottom-[-35%] h-[75%] origin-bottom rounded-[50%] bg-[radial-gradient(ellipse_at_50%_50%,rgba(216,253,52,0.9),rgba(216,253,52,0)_66%)] opacity-0 blur-2xl" />
        <div className="st-work-left absolute left-[36px] top-1/2 w-[min(290px,34vw)] -translate-y-1/2 max-md:left-5 max-md:top-[22%] max-md:w-[80vw] max-md:translate-y-0">
          <h2 className="mb-5 text-[clamp(30px,3.2vw,46px)] tracking-[-0.03em]">Ready-made trips</h2>
          <p className="mb-6 text-[15px] leading-snug text-white/75">From Paris cafés to Bali rice terraces: a sample of the 100+ trips you can book today. Prices and inventory are sample data.</p>
          <MonoLink href="/" className="text-[#d8fd34]">View all trips</MonoLink>
        </div>
        <div className="st-work-right absolute right-[36px] top-[54%] w-[min(300px,32vw)] max-md:right-5 max-md:top-auto max-md:bottom-[9%] max-md:w-[70vw]">
          <div key={f.slug} style={{ animation: "st-pill-in .55s both" }}>
            {f.image && (
              <figure className="relative mb-4 aspect-[16/10] overflow-hidden rounded-2xl bg-white/10" data-testid="story-card-photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.image.src} alt={`${f.cities.join(" and ")}: ${f.image.title}`} loading="eager" decoding="async" className="absolute inset-0 size-full object-cover" />
                <a href={f.image.sourceUrl} target="_blank" rel="noopener noreferrer" data-cursor="link" className="absolute bottom-1 right-1 max-w-[94%] truncate rounded-full bg-black/65 px-2 py-0.5 text-[10px] leading-tight text-white/85 hover:text-white">{f.image.credit}</a>
              </figure>
            )}
            <h3 className="mb-3 text-[clamp(26px,2.8vw,40px)] tracking-[-0.03em]">{f.title}</h3>
            <p className="st-mono mb-4 text-[12px] uppercase text-white/55"><span>· {f.sub}</span> <span className="ml-3">· Sample itinerary</span></p>
            <p className="mb-6 text-[15px] leading-snug text-white/80">{f.blurb}</p>
            <MonoLink href={`/itinerary/${f.slug}`}>View trip</MonoLink>
          </div>
        </div>
      </section>

      {/* =========================== WHY =========================== */}
      <section id="why" className="st-light relative h-[100svh] overflow-hidden max-md:h-auto max-md:py-20">
        <div className="st-container grid h-full grid-cols-12 items-center gap-6 max-md:block">
          <div className="col-span-12 md:col-span-4">
            <p className="st-mono mb-5 text-[11px] uppercase opacity-70">Why Safar Saathi</p>
            <h2 className="mb-6 text-[clamp(40px,4.8vw,70px)]">The right companion for the first flight.</h2>
            <p className="max-w-[340px] text-[14px] leading-snug opacity-80">Most travel apps stop at the confirmation email. We built around what happens next. There&apos;s a real difference in how we plan, how we help, and what&apos;s saved on your phone.</p>
          </div>
          <div className="relative col-span-12 h-[64svh] md:col-span-5 max-md:h-[56svh] max-md:mt-10">
            <svg className="absolute inset-0 size-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              <path className="why-line" pathLength={1} d="M44 50 C 58 50, 56 24, 70 24" fill="none" stroke="#050505" strokeOpacity=".5" strokeWidth=".35" vectorEffect="non-scaling-stroke" strokeDasharray="1" />
              <path className="why-line" pathLength={1} d="M44 50 C 58 50, 56 76, 70 76" fill="none" stroke="#050505" strokeOpacity=".5" strokeWidth=".35" vectorEffect="non-scaling-stroke" strokeDasharray="1" />
            </svg>
            <div className="why-t1 absolute left-[2%] top-[20%] flex h-[60%] w-[46%] flex-col items-center justify-center rounded-2xl bg-[radial-gradient(circle_at_30%_20%,#ecff80,#d8fd34_55%,#a6c41a)] text-center text-[#050505]">
              <p className="st-mono mb-2 text-[11px] uppercase opacity-70">Under</p><p className="text-[clamp(44px,5.6vw,84px)] leading-none tracking-[-0.035em]">5s</p>
              <p className="mt-3 px-5 text-[13px] leading-snug opacity-80">To answer a trip question, online.</p>
            </div>
            <div className="why-t2 absolute right-0 top-[6%] flex h-[36%] w-[42%] flex-col justify-between rounded-xl bg-[#1a1a1a] p-5 text-white"><p className="text-[clamp(32px,3.6vw,54px)] leading-none tracking-[-0.035em]">100%</p><p className="text-[13px] leading-snug text-white/75">Human confirmation on every change.</p></div>
            <div className="why-t3 absolute bottom-[6%] right-0 flex h-[36%] w-[42%] flex-col justify-between rounded-xl bg-white p-5"><div><p className="st-mono text-[10px] uppercase opacity-60">As little as</p><p className="text-[clamp(32px,3.6vw,54px)] leading-none tracking-[-0.035em]">30s</p></div><p className="text-[13px] leading-snug opacity-75">To an offline pack after you book.</p></div>
          </div>
          <div className="why-list col-span-12 md:col-span-3 max-md:mt-10">
            {WHY.map(([t, b]) => (<div key={t} className="st-acc-item py-4"><p className="text-[19px] leading-tight tracking-[-0.03em]">{t}</p><p className="mt-1 text-[13px] leading-snug opacity-70">{b}</p></div>))}
            <div className="pt-6"><MonoLink href="/" className="text-[#050505]">See the trips</MonoLink></div>
          </div>
        </div>
      </section>

      {/* =========================== MOMENTS (partner love) =========================== */}
      <section id="moments" className="relative overflow-hidden bg-gradient-to-b from-[#e2ff6a] via-[#eef9b8] to-[#f4f4ee] pb-24 pt-20 text-[#050505]">
        <div className="st-container mb-12 text-center" data-reveal>
          <p className="st-mono mb-4 text-[11px] uppercase opacity-70">Why we built it</p>
          <h2 className="text-[clamp(40px,5.6vw,80px)]">The moments we designed for.</h2>
          <p className="st-mono mx-auto mt-5 max-w-[520px] text-[11px] uppercase opacity-60">Illustrative scenarios from our prototype persona, Neha, 34, Pune. These are not customer reviews.</p>
        </div>
        <div className="relative overflow-hidden" aria-label="Scenarios">
          <div className="st-marquee-track flex w-max gap-5 px-5" style={{ animationDuration: "80s" }}>
            {[...MOMENTS, ...MOMENTS, ...MOMENTS, ...MOMENTS].map((m, i) => (
              <figure key={i} className="st-testi w-[min(440px,80vw)] shrink-0 p-7">
                <blockquote className="text-[17px] leading-snug tracking-[-0.02em]">&ldquo;{m}&rdquo;</blockquote>
                <figcaption className="st-mono mt-6 text-[11px] uppercase opacity-60">Neha, 34, Pune · prototype persona</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* =========================== CTA =========================== */}
      <section id="cta" className="relative flex min-h-[100svh] flex-col justify-between overflow-hidden bg-[#050505] pb-8 pt-28">
        <div className="pointer-events-none absolute inset-x-[-10%] bottom-[-30%] h-[70%] rounded-[50%] bg-[radial-gradient(ellipse_at_50%_50%,rgba(216,253,52,0.85),rgba(216,253,52,0)_68%)] blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[34%] select-none text-center text-[clamp(70px,17vw,260px)] font-normal uppercase leading-none tracking-[-0.035em] text-white/[0.05]">Safar Saathi</div>
        <div className="st-container relative z-10 flex flex-wrap items-start justify-between gap-10">
          <div data-reveal>
            <p className="st-mono mb-5 text-[11px] uppercase text-white/50">Ready for boarding</p>
            <h2 className="text-[clamp(38px,5vw,72px)]">Let&apos;s plan your<br />first flight.</h2>
          </div>
          <div className="w-full max-w-[420px] md:text-right" data-reveal>
            <Link href="/" data-cursor="link" className="st-mono block rounded-full bg-[#e6ff6b] px-6 py-5 text-center text-[15px] uppercase text-[#050505] transition-colors hover:bg-[#d8fd34]"><Scramble text="Start your trip ⟶" /></Link>
            <p className="st-mono mt-4 text-[12px] uppercase text-white/55">Or <Link href="/api/auth/demo?next=/trips" prefetch={false} className="inline-flex min-h-11 items-center text-[#d8fd34] underline underline-offset-4">try the demo as Neha</Link></p>
          </div>
        </div>
        <div className="st-container st-mono relative z-10 flex flex-wrap items-end justify-between gap-4 text-[12px] uppercase text-white/55">
          <p>© 2026 Safar Saathi · Prototype · Sample data · Test payments only</p>
          <p className="flex gap-5 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center"><Link href="/">Explore</Link><Link href="/trips">My trips</Link><Link href="/login">Sign in</Link><Link href="/admin/cases">Admin</Link></p>
        </div>
      </section>
    </div>
  );
}
