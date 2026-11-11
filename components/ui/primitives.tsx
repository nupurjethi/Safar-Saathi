import clsx from "clsx";
import Link from "next/link";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANTS: Record<Variant, string> = {
  // One primary action per screen, always lime. Destructive actions are never lime.
  primary: "bg-lime text-lime-ink hover:brightness-105 active:brightness-95",
  secondary: "bg-surface-2 text-ink border border-line hover:border-muted",
  danger: "bg-danger text-danger-ink hover:brightness-110",
  ghost: "text-ink hover:bg-surface-2",
};
const SIZES = { md: "min-h-11 px-4 text-[14px] sm:px-6", lg: "min-h-12 px-5 text-[15px] sm:px-8", xl: "min-h-16 px-6 text-xl sm:px-8" };

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZES; block?: boolean };
export function Button({ variant = "secondary", size = "lg", block, className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={clsx("inline-flex items-center justify-center gap-2 rounded-full font-bold transition-all duration-200 ease-out disabled:opacity-50 disabled:pointer-events-none", VARIANTS[variant], SIZES[size], block && "w-full", className)}
    />
  );
}

export function LinkButton({ href, variant = "secondary", size = "lg", block, className, children, ...p }: { href: string; variant?: Variant; size?: keyof typeof SIZES; block?: boolean; className?: string; children: ReactNode } & Omit<React.ComponentProps<typeof Link>, "href">) {
  return (
    <Link href={href} {...p} className={clsx("inline-flex items-center justify-center gap-2 rounded-full font-bold transition-all duration-200 ease-out", VARIANTS[variant], SIZES[size], block && "w-full", className)}>
      {children}
    </Link>
  );
}

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={clsx("card p-4", className)} />;
}

export function Chip({ active, className, children, ...p }: { active?: boolean } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...p} className={clsx("inline-flex min-h-11 items-center gap-1 rounded-full border px-4 text-[14px] font-medium", active ? "border-lime bg-lime text-lime-ink" : "border-line bg-surface text-ink", className)}>
      {children}
    </span>
  );
}

export function Badge({ tone = "muted", className, children, dot }: { tone?: "muted" | "lime" | "warn" | "danger" | "ok"; className?: string; children: ReactNode; dot?: boolean }) {
  const t = { muted: "text-muted border-line", lime: "text-accent border-lime", warn: "text-warn border-warn", danger: "text-danger border-danger", ok: "text-ok border-ok" }[tone];
  return <span className={clsx("inline-flex items-center gap-1.5 rounded-full border bg-surface px-3 py-0.5 text-[12px] font-semibold uppercase tracking-wide", t, className)}>{dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}{children}</span>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("skeleton", className)} />;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="text-[20px] font-semibold">{children}</h2>
      {aside}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-10 text-center">
      <h3 className="text-[20px] font-semibold">{title}</h3>
      {body && <p className="max-w-md text-muted">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", body, retry }: { title?: string; body?: string; retry?: () => void }) {
  return (
    <div role="alert" className="card flex flex-col items-center gap-3 border-danger px-6 py-8 text-center">
      <h3 className="text-[20px] font-semibold">{title}</h3>
      {body && <p className="max-w-md text-muted">{body}</p>}
      {retry && <Button onClick={retry}>Try again</Button>}
    </div>
  );
}

export const SAMPLE_TAG = "Sample";
export function SampleTag({ className }: { className?: string }) {
  return <Badge className={clsx("bg-bg/70 backdrop-blur", className)}>{SAMPLE_TAG}</Badge>;
}
