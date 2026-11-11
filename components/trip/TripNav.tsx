"use client";
import { House, LifeBuoy, ListChecks, Map as MapIcon, MessageCircle, ScrollText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { seg: "", label: "Home", Icon: House },
  { seg: "/chat", label: "Agent", Icon: MessageCircle },
  { seg: "/guide", label: "Guide", Icon: ListChecks },
  { seg: "/map", label: "Map", Icon: MapIcon },
  { seg: "/sos", label: "SOS", Icon: LifeBuoy },
  { seg: "/log", label: "Log", Icon: ScrollText },
];

export function TripNav({ refCode }: { refCode: string }) {
  const path = usePathname();
  const base = `/trips/${refCode}`;
  return (
    <nav aria-label="Trip" className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-safe backdrop-blur sm:sticky sm:top-[57px] sm:bottom-auto sm:border-b sm:border-t-0">
      <ul className="mx-auto flex max-w-3xl items-stretch justify-around gap-1 px-1 sm:justify-start sm:gap-2 sm:px-4">
        {TABS.map(({ seg, label, Icon }) => {
          const href = base + seg;
          const active = seg === "" ? path === base : path.startsWith(href);
          const sos = seg === "/sos";
          return (
            <li key={seg} className="flex-1 sm:flex-none">
              <Link href={href} aria-current={active ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[13px] font-semibold sm:flex-row sm:gap-2 sm:px-4 sm:text-[15px] ${sos ? (active ? "text-danger" : "text-danger/90") : active ? "text-accent" : "text-muted"}`}>
                <Icon size={22} strokeWidth={1.75} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
