import { BellRing, CloudOff, Compass, CreditCard, MessageSquareText } from "lucide-react";
import { LinkButton } from "@/components/ui/primitives";

const STEPS = [
  { icon: Compass, title: "Pick a trip", body: "Browse sample trips by month, budget and theme. Select one and its plan, map, contacts and help guides are saved on your phone before you pay.", href: "#results", cta: "Browse trips" },
  { icon: CreditCard, title: "Pay when ready", body: "Booking is a test payment here, no money moves. Paying confirms the trip and unlocks changes through the agent.", href: "/trips", cta: "My trips" },
  { icon: CloudOff, title: "Use it with no data", body: "Day plan with photos, a real street map with your GPS dot, six problem guides and the offline assistant all work in airplane mode.", href: "/trips", cta: "Open my trips" },
  { icon: BellRing, title: "Get help fast", body: "Tap SOS, or text the helpline. With no data the SOS waits on your phone and sends the moment you are back online. An agent is alerted." },
  { icon: MessageSquareText, title: "Change plans, you confirm", body: "Ask the Trip agent. Flights are changed on your own booking platform (MakeMyTrip, Goibibo, Cleartrip or ixigo), stays here. Nothing happens until you tap Confirm." },
] as const;

/** A short guide to the app for signed-in travel users. The full animated version is at /story. */
export function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works" data-testid="how-it-works" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="how-it-works" className="text-[24px] font-semibold leading-tight">How Safar Saathi works</h2>
        <LinkButton href="/story" size="md" variant="ghost">Watch the full story</LinkButton>
      </div>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {STEPS.map((s, i) => (
          <li key={s.title} className="card flex flex-col gap-2 p-4">
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-lime text-lime-ink"><s.icon size={20} strokeWidth={1.9} /></span>
              <span className="font-mono text-[13px] text-muted">Step {i + 1}</span>
            </div>
            <h3 className="text-[18px] font-semibold leading-snug">{s.title}</h3>
            <p className="flex-1 text-[15px] text-muted">{s.body}</p>
            {"href" in s && <a href={s.href} className="inline-flex min-h-11 items-center text-[15px] font-semibold text-accent underline underline-offset-4">{s.cta}</a>}
          </li>
        ))}
      </ol>
      <p className="text-[13px] text-muted">All trips, flights, hotels and prices are sample data. Maps are OpenStreetMap, photos are openly licensed Wikimedia Commons images.</p>
    </section>
  );
}
