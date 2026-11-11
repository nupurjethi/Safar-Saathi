import { Headset, Plane } from "lucide-react";
import { LinkButton } from "@/components/ui/primitives";
import { getSession } from "@/lib/server/session";

/** First thing on the first page: who are you? Travel user or agent. Signed-in people get a way back in instead. */
export async function RoleLogin() {
  const sess = await getSession().catch(() => null);
  const staff = sess && (sess.role === "agent" || sess.role === "admin");
  if (sess) {
    return (
      <section aria-label="Your account" data-testid="role-login" className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-[16px]">Signed in as <b>{sess.name}</b> <span className="text-muted">({staff ? "agent" : "travel user"})</span></p>
        <LinkButton href={staff ? "/agent" : "/trips"} variant="primary" size="md" data-testid="role-continue">{staff ? "Open agent desk" : "Open my trips"}</LinkButton>
      </section>
    );
  }
  return (
    <section aria-label="Sign in" data-testid="role-login" className="grid gap-3 sm:grid-cols-2">
      <div className="card flex items-center gap-4 p-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-lime text-lime-ink"><Plane size={22} /></span>
        <div className="min-w-0 flex-1"><p className="text-[18px] font-semibold leading-tight">Travel user login</p><p className="text-[14px] text-muted">Your trips, offline guide, map and SOS.</p></div>
        <LinkButton href="/login?role=traveller" variant="primary" size="md" data-testid="login-traveller" prefetch={false}>Login</LinkButton>
      </div>
      <div className="card flex items-center gap-4 p-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full border border-line bg-surface-2 text-ink"><Headset size={22} /></span>
        <div className="min-w-0 flex-1"><p className="text-[18px] font-semibold leading-tight">Agent login</p><p className="text-[14px] text-muted">Emergency alerts and help requests.</p></div>
        <LinkButton href="/login?role=agent" size="md" data-testid="login-agent" prefetch={false}>Login</LinkButton>
      </div>
    </section>
  );
}
