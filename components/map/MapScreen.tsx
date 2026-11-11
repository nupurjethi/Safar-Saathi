"use client";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { MapPin } from "lucide-react";
import { TripGate } from "@/components/trip/TripGate";
import { useTrip } from "@/components/trip/TripProvider";
import { Skeleton } from "@/components/ui/primitives";
import { currentStay } from "@/lib/rules/context";

const TripMap = dynamic(() => import("./TripMap").then((m) => m.TripMap), { ssr: false, loading: () => <Skeleton className="h-[60dvh]" /> });

function Inner() {
  const t = useTrip();
  const sp = useSearchParams();
  const routeId = sp.get("route");
  const pin = sp.get("pin");
  // Native History API (integrated with the Next router): no network round trip, so it works in airplane mode.
  const setRoute = (id: string | null) => window.history.replaceState(null, "", `/trips/${t.ref}/map${id ? `?route=${encodeURIComponent(id)}` : ""}`);
  return (
    <TripGate>
      {(pack) => {
        const stay = currentStay(pack, t.now);
        const mine = pack.routes.filter((r) => pack.places[r.from]?.city === stay.city || pack.places[r.to]?.city === stay.city);
        return (
          <div className="space-y-3">
            <h1 className="sr-only">Offline map</h1>
            <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Saved routes">
              {mine.map((r) => (
                <button key={r.id} onClick={() => setRoute(r.id)} aria-pressed={routeId === r.id} data-testid="route-chip" className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] px-3 text-[15px] font-medium ${routeId === r.id ? "border-lime bg-lime text-lime-ink" : "border-line bg-surface"}`}>
                  <MapPin size={16} /> {r.fromName.split(" (")[0]} → {r.toName.split(" (")[0]}
                </button>
              ))}
            </div>
            <TripMap pack={pack} routeId={routeId} pin={pin} onRoute={setRoute} focusCity={stay.city} />
            <p className="text-[13px] text-muted">Real OpenStreetMap map, saved on your phone. GPS works with no mobile data. Offline limits: no live traffic or transit times, no address search, and navigation pauses when the browser is in the background. Routes were saved when you booked.</p>
          </div>
        );
      }}
    </TripGate>
  );
}

export function MapScreen() {
  return <Suspense fallback={<Skeleton className="h-[60dvh]" />}><Inner /></Suspense>;
}
