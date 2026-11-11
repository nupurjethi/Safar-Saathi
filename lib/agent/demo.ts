import { inr } from "@/lib/time";
import { runTool, type ToolCtx } from "./tools";
import { rateSeverity } from "./severity";

/**
 * STUB: deterministic "demo agent" used when no LLM key is configured. It calls the SAME eight tools through the
 * SAME gate as the real model, with keyword intent matching instead of a language model. The UI labels it.
 */
type Emit = { step: (name: string, status: "running" | "done" | "error") => void; text: (t: string) => void };

type Flight = { itemId: string; leg: string; flightNo: string; carrier: string; from: string; to: string; departsUtc: string; date: string };
const isErr = (x: unknown): x is { error: string; message: string } => !!x && typeof x === "object" && "error" in x && !("applied" in x);

async function call(name: Parameters<typeof runTool>[0], input: unknown, ctx: ToolCtx, e: Emit) {
  e.step(name, "running");
  const out = await runTool(name, input, ctx);
  e.step(name, isErr(out) ? "error" : "done");
  return out as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function demoAgent(message: string, ctx: ToolCtx, e: Emit): Promise<string> {
  const m = message.toLowerCase();
  const rating = rateSeverity(message);

  if (rating.severity <= 2 || /\b(sos|help me|human|agent|person)\b/.test(m)) {
    const r = await call("escalate_human", { summary: message.slice(0, 380), severity: rating.severity }, ctx, e);
    if (isErr(r)) return `I could not open a case just now (${r.message}). Please tap SOS in the app, or text SOS to our number.`;
    const guide = rating.scenario ? ` Meanwhile, open Offline guide, "${rating.reason}" for steps that work with no data.` : "";
    return r.severity === 1
      ? `I have paged a person on our team. Case ID ${r.caseRef}. I cannot close this case myself; a human will.${guide}`
      : `I have opened case ${r.caseRef} and our team will follow up.${guide}`;
  }

  const it = await call("get_itinerary", {}, ctx, e);
  if (isErr(it)) return `I could not load your trip: ${it.message}. I can pass this to our team if you like.`;
  const flights = (it.flights as Flight[]) ?? [];

  if (/\b(extend|extra night|stay (longer|more)|one more night|add (a )?night)\b/.test(m)) {
    const n = Math.min(14, Math.max(1, Number(m.match(/\b(\d{1,2})\b/)?.[1] ?? (/\btwo\b/.test(m) ? 2 : 1))));
    const r = await call("compare_hotels", { extraNights: n }, ctx, e);
    if (isErr(r)) return r.message;
    if (!r.configured) return `To stay ${n} more night${n > 1 ? "s" : ""} you book on a travel platform. I cannot log in there for you (I never see your password), and I do not have a live hotel price feed connected, so I cannot compare prices. The card below has links to MakeMyTrip, Goibibo, Cleartrip and ixigo and the exact city and dates to search. Compare there, pay there, then record your booking on the card. You review it and tap Yes before I update your trip. Your flight does not move automatically: ask me if you fly later.`;
    if (!(r.offers as unknown[]).length) return "The price source returned no hotels for those dates. Try other dates, or search on a platform from the card.";
    return `I compared live hotel prices near your stay. Cheapest: ${r.cheapest}. Those are reference prices, so open your platform from the card, log in, book and pay there, then record the booking on the card. I cannot log in or take payment. Your flight does not move automatically.`;
  }

  if (/\b(move|change|rebook|re-book|reschedule|later|earlier|shift|cancel|refund)\b.*\b(flight|fly)\b|\b(flight|fly)\b.*\b(move|change|rebook|later|earlier|cancel|refund)\b|\brebook\b/.test(m)) {
    const want = /return|home|back to (pune|india)|last/.test(m) ? "return" : /outbound|first|to paris|going/.test(m) ? "outbound" : /intercity|next/.test(m) ? "intercity" : null;
    const upcoming = flights.filter((f) => new Date(f.departsUtc).getTime() > Date.now());
    const target = flights.find((f) => f.leg === want) ?? upcoming.find((f) => f.leg === "intercity") ?? upcoming[0] ?? flights[0];
    if (!target) return "I do not see a flight on this booking.";
    const r = await call("compare_flights", { itemId: target.itemId }, ctx, e);
    if (isErr(r)) return r.message;
    if (!r.configured) {
      return `To change ${target.flightNo} (${target.from} to ${target.to}) you book the new flight on a travel platform. I cannot log in there for you (I never see your password), and I do not have a live price feed connected, so I cannot compare prices for you. Pick MakeMyTrip, Goibibo, Cleartrip or ixigo below (pre-filled for this route), sign in on their site, compare what they show and pay there. Then come back and enter your new flight on the card. You review it and tap Yes, and only then I update your trip and offline guide.`;
    }
    if (!(r.offers as unknown[]).length) return "The price sources returned no flights for that route and day. Try another date, or open a platform below.";
    return `I compared live fares from ${(r.providers as { name: string }[]).map((p) => p.name).join(" and ")}. Cheapest: ${r.cheapest}. The table below shows every option. Those are reference fares; the platforms can show a different price, so open your platform from the card (pre-filled), log in there, check the same flight and pay there. I cannot log in or take payment. After you pay, record the booking on the card and tap Yes.`;
  }

  if (/\b(route|directions?|how (do|can) i get|navigate|walk|way to)\b/.test(m)) {
    const to = message.match(/\bto\s+(?:the\s+)?([a-z' .-]{3,40})\??$/i)?.[1]?.trim() ?? "airport";
    const r = await call("get_route", { to }, ctx, e);
    if (isErr(r) || !r.found) return `${isErr(r) ? r.message : r.message} Saved routes: ${((r as any).savedRoutes ?? []).slice(0, 4).join("; ")}.`; // eslint-disable-line @typescript-eslint/no-explicit-any
    return `${r.from} to ${r.to}: about ${r.distanceKm} km, ${r.minutes} min by ${r.mode}.${r.approximate ? " This is a straight-line sample route." : ""} Tap "Open on map" below. It works offline once your guide is saved.`;
  }

  if (/\b(pick-?up|pickup|driver|transfer|picked up)\b/.test(m)) {
    const p = it.pickup;
    return `Your pickup in ${it.currentCity}: ${p.date ?? ""} ${p.time ?? p.when} (about 60 min after landing). Driver ${p.driver}, ${p.vendor}. Show code ${p.code}. They take you to ${p.to}.`;
  }
  if (/\b(hotel|address|where (are we|am i) staying|check-?in|check-?out)\b/.test(m)) {
    const h = it.hotel;
    return `${h.name}. ${h.address}. Check-in ${h.checkIn}, check-out ${h.checkOut}. Local-script address for a driver: ${h.addressLocal}.`;
  }
  if (/\b(time|what time|local time)\b/.test(m)) return `It is ${it.travellerLocalTime} in ${it.currentCity}.`;
  if (/\b(flight|fly|plane)\b/.test(m)) {
    const f = flights[0] && flights.find((x) => new Date(x.departsUtc).getTime() > Date.now()) ;
    return f ? `Next flight: ${f.carrier} ${f.flightNo}, ${f.from} to ${f.to}, ${f.date}. Want me to look at other times?` : "I do not see an upcoming flight.";
  }
  const next = (it.nextPlans as { date: string; time: string; what: string }[]).slice(0, 3).map((p) => `${p.date} ${p.time} ${p.what}`).join("; ");
  return `Here is what is next: ${next}. I can answer about pickup, hotel, directions, change a flight, or extend your stay.`;
}

export { inr };
