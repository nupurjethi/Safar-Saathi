import { CloudOff, MessageSquareText } from "lucide-react";
import Link from "next/link";

/** Two separate chats: the online Trip agent and the offline assistant. Never mixed. */
export function ChatTabs({ refCode, active }: { refCode: string; active: "online" | "offline" }) {
  const tab = (key: "online" | "offline", href: string, label: string, icon: React.ReactNode) => (
    <Link href={href} aria-current={active === key ? "page" : undefined} data-testid={`chat-tab-${key}`}
      className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full px-3 text-[15px] font-semibold ${active === key ? "bg-lime text-lime-ink" : "text-muted hover:text-ink"}`}>
      {icon}{label}
    </Link>
  );
  return (
    <nav aria-label="Chats" className="grid grid-cols-2 gap-1 rounded-full border border-line bg-surface-2 p-1">
      {tab("online", `/trips/${refCode}/chat`, "Trip agent", <MessageSquareText size={16} />)}
      {tab("offline", `/trips/${refCode}/offline`, "Offline assistant", <CloudOff size={16} />)}
    </nav>
  );
}
