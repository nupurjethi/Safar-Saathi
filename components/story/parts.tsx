"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

const GLYPHS = ")(%&$·{[9@+/=|€}]0";

/** Hover scramble, as on the reference's buttons: characters shuffle through symbols, then resolve. */
export function Scramble({ text, className = "" }: { text: string; className?: string }) {
  const [out, setOut] = useState(text);
  const raf = useRef<number | null>(null);
  const run = useCallback(() => {
    const start = performance.now();
    const dur = 520;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      setOut([...text].map((ch, i) => (ch === " " ? " " : i / text.length < k ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join(""));
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
  }, [text]);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);
  return <span className={className} onMouseEnter={run} onFocus={run} aria-label={text}><span aria-hidden>{out}</span></span>;
}

export function MonoLink({ href, children, className = "", prefetch, testId }: { href: string; children: string; className?: string; prefetch?: boolean; testId?: string }) {
  return (
    <Link href={href} prefetch={prefetch} data-testid={testId} data-cursor="link" className={`st-mono group inline-flex min-h-11 items-center gap-2 text-[14px] uppercase tracking-tight ${className}`}>
      <Scramble text={children} />
      <span aria-hidden className="inline-block transition-transform duration-300 group-hover:translate-x-1">⟶</span>
    </Link>
  );
}

export function Marquee({ items, className = "", speed = 40 }: { items: string[]; className?: string; speed?: number }) {
  const row = [...items, ...items, ...items, ...items];
  return (
    <div className={`st-marquee overflow-hidden ${className}`} aria-hidden>
      <div className="st-marquee-track flex w-max items-center" style={{ animationDuration: `${speed}s` }}>
        {row.map((t, i) => (<span key={i} className="flex items-center"><span>{t}</span><span className="mx-3 opacity-60">⋅</span></span>))}
      </div>
    </div>
  );
}

/** Soft green cursor: dot + trailing ring, grows over links. Desktop with a fine pointer only. */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y, big = false, raf = 0;
    const move = (e: PointerEvent) => { x = e.clientX; y = e.clientY; big = !!(e.target as HTMLElement)?.closest?.("a,button,[data-cursor]"); };
    const loop = () => {
      rx += (x - rx) * 0.16; ry += (y - ry) * 0.16;
      if (dot.current) dot.current.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
      if (ring.current) ring.current.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%) scale(${big ? 1.9 : 1})`;
      raf = requestAnimationFrame(loop);
    };
    addEventListener("pointermove", move, { passive: true });
    raf = requestAnimationFrame(loop);
    return () => { removeEventListener("pointermove", move); cancelAnimationFrame(raf); };
  }, []);
  return (
    <>
      <div ref={ring} aria-hidden className="pointer-events-none fixed left-0 top-0 z-[60] hidden size-9 rounded-full border border-[#d8fd34]/70 mix-blend-difference transition-[scale] duration-200 [@media(pointer:fine)]:block" />
      <div ref={dot} aria-hidden className="pointer-events-none fixed left-0 top-0 z-[60] hidden size-1.5 rounded-full bg-[#d8fd34] [@media(pointer:fine)]:block" />
    </>
  );
}

export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 40" className={className} fill="none" stroke="#d8fd34" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 22 L58 4 L40 36 L31 23 Z" />
      <path d="M31 23 L58 4" />
      <path d="M31 23 L33 33" />
    </svg>
  );
}
