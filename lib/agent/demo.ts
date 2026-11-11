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
    const n = Math.min(3, Math.max(1, Number(m.match(/\b([1-3])\b/)?.[1] ?? (/\btwo\b/.test(m) ? 2 : 1))));
    const st = await call("search_stays", { extraNights: n }, ctx, e);
    if (isErr(st) || !st.available) return isErr(st) ? st.message : `${st.hotel} has no rooms for all ${n} extra night(s). I can pass this to our team if you want.`;
    const q = await call("quote_change", { kind: "hotel_extend", extraNights: n }, ctx, e);
    if (isErr(q)) return q.message;
    const opt = (q.options as { blocked: boolean; price: string }[])[0];
    if (opt.blocked) {
      const c = await call("escalate_human", { summary: `Hotel extension of ${n} night(s) quoted at ${opt.price}, above the price limit.`, severity: 3 }, ctx, e);
      return `That costs more than our price limit, so I have passed it to our team. Case ID ${c.caseRef ?? ""}.`;
    }
    return `${st.hotel} can host you ${n} more night${n > 1 ? "s" : ""} (to ${st.newCheckOut}). Your return flight and airport drop-off move with it. Total ${opt.price} for all travellers, with the full breakup on the card. Tap Yes to confirm or No. Nothing is booked until you do.`;
  }

  if (/\b(move|change|rebook|re-book|reschedule|later|earlier|shift)\b.*\b(flight|fly)\b|\b(flight|fly)\b.*\b(move|change|rebook|later|earlier)\b|\brebook\b/.test(m)) {
    const want = /return|home|back to (pune|india)|last/.test(m) ? "return" : /outbound|first|to paris|going/.test(m) ? "outbound" : /paris.*rome|rome|intercity|next/.test(m) ? "intercity" : null;
    const upcoming = flights.filter((f) => new Date(f.departsUtc).getTime() > Date.now());
    const target = flights.find((f) => f.leg === want) ?? upcoming.find((f) => f.leg === "intercity") ?? upcoming[0] ?? flights[0];
    if (!target) return "I do not see a flight on this booking.";
    const s = await call("search_flights", { itemId: target.itemId }, ctx, e);
    if (isErr(s)) return s.message;
    const alts = s.alternatives as { flightId: string; flightNo: string; carrier: string; departsUtc: string; departsLocal: string; arrivesLocal: string }[];
    if (!alts.length) return `I found no other seats on ${target.flightNo} for that day. I can pass this to our team.`;
    const cur = new Date(s.currentFlight.departsUtc).getTime();
    const wantEarlier = /earlier|sooner|before/.test(m);
    const pool = alts.filter((a) => (wantEarlier ? new Date(a.departsUtc).getTime() < cur : new Date(a.departsUtc).getTime() > cur));
    const near = (a: { departsUtc: string }) => Math.abs(new Date(a.departsUtc).getTime() - cur);
    // the preferred direction first, then the nearest others, so the traveller sees up to 3 options
    const picks = [...[...pool].sort((a, b) => near(a) - near(b)), ...alts.filter((a) => !pool.includes(a)).sort((a, b) => near(a) - near(b))].slice(0, 3);
    const q = await call("quote_change", { kind: "flight_change", itemId: target.itemId, newFlightIds: picks.map((p) => p.flightId) }, ctx, e);
    if (isErr(q)) return q.message;
    const opts = q.options as { blocked: boolean; price: string }[];
    if (opts.every((o) => o.blocked)) {
      const c = await call("escalate_human", { summary: `Flight change options all above the price limit (${opts[0].price}).`, severity: 3 }, ctx, e);
      return `These options cost more than our price limit, so a person on our team must handle it. Case ID ${c.caseRef ?? ""}.`;
    }
    return `I found ${picks.length} option${picks.length > 1 ? "s" : ""} to move ${target.flightNo}. Each card shows the full price breakup. Compare them, then tap Yes on one, or No. Nothing changes until you do.`;
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
