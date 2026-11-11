import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <nav aria-label="Admin" className="flex flex-wrap gap-2">
        {[["/agent", "Agent desk"], ["/admin/cases", "Case inbox"], ["/admin/sms-sim", "SMS simulator"], ["/admin/reset", "Reset demo data"]].map(([h, l]) => (
          <Link key={h} href={h} className="inline-flex min-h-11 items-center rounded-full border-[1.5px] border-line bg-surface px-4 font-semibold hover:border-muted">{l}</Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
