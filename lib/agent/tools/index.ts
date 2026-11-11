/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq } from "drizzle-orm";
import { tool } from "ai";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { applyChange, createQuote, type ReviewCard } from "@/lib/gate/changes";
import { GateError } from "@/lib/gate/errors";
import { getLatestPack } from "@/lib/packs/build";
import type { OfflinePack } from "@/lib/packs/types";
import { currentStay } from "@/lib/rules/context";
import { openCase, maskPhone } from "@/lib/server/cases";
import { searchFlights } from "@/app/api/mock/v1/flights/search/route";
import { stayAvailability } from "@/app/api/mock/v1/stays/availability/route";
import { getSmsAdapter } from "@/lib/sms/adapter";
import { flightProviders, MOCK_SOURCE } from "@/lib/providers";
import { searchWeb } from "@/lib/providers/web";
import { refreshOfflinePack } from "@/lib/packs/refresh";
import { addDays, fmtDate, inr, localDate, localTime, tzLabel, zonedToUtc } from "@/lib/time";
import { rateSeverity, SLA_SECONDS, type Severity } from "../severity";

export type UiEvent =
  | { t: "review"; card: ReviewCard }
  | { t: "case"; caseRef: string; severity: number; slaSeconds: number; summary: string }
  | { t: "route"; routeId: string; fromName: string; toName: string; distance_m: number; duration_s: number; approximate: boolean; url: string }
  | { t: "receipt"; receipt: unknown };

export type ToolCtx = {
  userId: string;
  bookingRef: string;
  bookingId: string;
  threadId: string | null;
  channel: "app" | "sms";
  now: Date;
  chaos?: string | null;
  /** Only ever set by the server when the traveller's client sends a token minted by their Confirm tap. Never given to the model. */
  confirmationToken?: string | null;
  ui: (e: UiEvent) => void;
};

export const TOOL_NAMES = ["get_itinerary", "get_route", "search_flights", "search_stays", "search_web", "quote_change", "apply_change", "refresh_offline_pack", "escalate_human", "send_sms"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
/** The model's allow-list. refresh_offline_pack is a server-side job that runs only after apply_change succeeds. */
export const MODEL_TOOLS: ToolName[] = TOOL_NAMES.filter((t) => t !== "refresh_offline_pack");

/** Tools that SMS-channel runs may use (read-only plus escalation). */
export const SMS_SAFE_TOOLS: ToolName[] = ["get_itinerary", "escalate_human", "send_sms"];

async function logged<T>(ctx: ToolCtx, name: ToolName, input: unknown, fn: () => Promise<T>): Promise<T | { error: string; message: string }> {
  const db = await getDb();
  const t0 = Date.now();
  try {
    const out = await fn();
    await db.insert(s.toolCalls).values({ threadId: ctx.threadId, bookingId: ctx.bookingId, tool: name, input: input as never, output: out as never, status: "ok", latencyMs: Date.now() - t0 });
    return out;
  } catch (e) {
    const err = e instanceof GateError ? { error: e.code, message: e.message } : { error: "TOOL_ERROR", message: e instanceof Error ? e.message : String(e) };
    await db.insert(s.toolCalls).values({ threadId: ctx.threadId, bookingId: ctx.bookingId, tool: name, input: input as never, output: err as never, status: e instanceof GateError && (e.code === "NO_TOKEN" || e.code === "OVER_LIMIT") ? "blocked" : "error", latencyMs: Date.now() - t0 });
    return err;
  }
}

async function loadPack(ctx: ToolCtx) {
  const db = await getDb();
  const row = await getLatestPack(ctx.bookingId, db);
  if (!row) throw new GateError("NOT_FOUND", 404, "No trip data found for this booking.");
  return row.pack as OfflinePack;
}

/* ---------------------------- tool implementations ---------------------------- */

export async function getItinerary(ctx: ToolCtx) {
  const db = await getDb();
  const pack = await loadPack(ctx);
  const stay = currentStay(pack, ctx.now);
  const localNow = `${localTime(ctx.now, stay.tz)} ${tzLabel(ctx.now, stay.tz)}`;
  const flat = pack.days.flatMap((d) => d.items.map((i) => ({ ...i, date: d.date, city: d.cityName, at: zonedToUtc(d.date, i.time, d.tz) })));
  const upcoming = flat.filter((i) => i.at.getTime() >= ctx.now.getTime() - 30 * 60_000).slice(0, 4);
  const status = ctx.now < new Date(`${pack.booking.dates[0]}T00:00:00Z`) ? "not started" : ctx.now > new Date(`${pack.booking.dates[1]}T23:59:00Z`) ? "finished" : "in progress";
  const flights = await db.select().from(s.bookingItems).where(and(eq(s.bookingItems.bookingId, ctx.bookingId), eq(s.bookingItems.kind, "flight"), eq(s.bookingItems.status, "confirmed")));
  const hotel = pack.places[stay.hotelId];
  const pu = flat.find((i) => i.type === "transfer" && /^Pickup/.test(i.title) && i.date === stay.from);
  const show = (i: (typeof flat)[number]) => ({ date: fmtDate(i.date), time: i.time, what: i.title, notes: i.notes });
  return {
    bookingRef: pack.booking.ref, title: pack.booking.title, dates: pack.booking.dates, travellers: pack.booking.pax, tripStatus: status,
    today: localDate(ctx.now, stay.tz), travellerLocalTime: localNow, timezone: stay.tz, currentCity: stay.cityName,
    nextPlans: (upcoming.length ? upcoming : flat.slice(0, 4)).map(show),
    pickup: { date: pu ? fmtDate(pu.date) : undefined, time: pu?.time, when: stay.driver.pickup_time, driver: stay.driver.name, vendor: stay.driver.vendor, code: stay.driver.pickup_code, phoneSample: stay.driver.phone, to: hotel.name },
    hotel: { name: hotel.name, address: hotel.address, addressLocal: hotel.address_local, phoneSample: hotel.phone, checkIn: fmtDate(stay.from), checkOut: fmtDate(stay.to) },
    flights: flights
      .map((f) => ({ itemId: f.id, leg: f.details.leg, flightNo: f.details.flightNo, carrier: f.details.carrierName, from: f.details.from, to: f.details.to, departsUtc: f.details.departAt, arrivesUtc: f.details.arriveAt, farePerTravellerInr: f.details.farePerPaxInr, changeFeeInr: f.details.changeFeeInr, date: f.date }))
      .sort((a, b) => String(a.departsUtc).localeCompare(String(b.departsUtc))),
    totalInr: pack.booking.totalInr,
    note: "Sample data from the traveller's booking.",
  };
}

export async function getRoute(ctx: ToolCtx, input: { from?: string; to: string }) {
  const pack = await loadPack(ctx);
  const stay = currentStay(pack, ctx.now);
  const find = (q: string | undefined, dflt: string) => {
    const t = (q ?? "").toLowerCase().trim();
    if (!t || t === "hotel" || t === "my hotel") return pack.places[stay.hotelId];
    if (t.includes("airport")) return pack.places[stay.airportId];
    const all = Object.values(pack.places);
    return all.find((p) => p.id === t) ?? all.find((p) => p.name.toLowerCase().includes(t)) ?? all.find((p) => t.includes(p.name.toLowerCase())) ?? pack.places[dflt];
  };
  const from = find(input.from, stay.hotelId);
  const to = find(input.to, stay.hotelId);
  const route = pack.routes.find((r) => r.from === from.id && r.to === to.id) ?? pack.routes.find((r) => r.from === to.id && r.to === from.id);
  if (!route) return { found: false, message: "No saved route between those two places.", savedRoutes: pack.routes.map((r) => `${r.fromName} to ${r.toName}`) };
  const u: UiEvent = { t: "route", routeId: route.id, fromName: route.fromName, toName: route.toName, distance_m: route.distance_m, duration_s: route.duration_s, approximate: route.approximate, url: `/trips/${ctx.bookingRef}/map?route=${encodeURIComponent(route.id)}` };
  ctx.ui(u);
  return { found: true, from: route.fromName, to: route.toName, mode: route.mode, distanceKm: Math.round(route.distance_m / 100) / 10, minutes: Math.round(route.duration_s / 60), approximate: route.approximate, steps: route.steps.slice(0, 6).map((x) => x.instruction), openOnMap: u.url };
}

export async function searchFlightsTool(ctx: ToolCtx, input: { itemId: string; date?: string }) {
  const db = await getDb();
  const [item] = await db.select().from(s.bookingItems).where(and(eq(s.bookingItems.id, input.itemId), eq(s.bookingItems.bookingId, ctx.bookingId)));
  if (!item || item.kind !== "flight") throw new GateError("NOT_FOUND", 404, "That flight is not on this booking. Use get_itinerary to find itemId values.");
  const d = item.details as Record<string, string | number>;
  const pack = await loadPack(ctx);
  const f = pack.flights.find((x) => x.flight_no === d.flightNo)!;
  const anchor = d.leg === "outbound" ? "arrive" : "depart";
  const date = input.date ?? (anchor === "arrive" ? localDate(new Date(String(d.arriveAt)), f.to_tz) : localDate(new Date(String(d.departAt)), f.from_tz));
  const alts = await searchFlights({ from: String(d.from), to: String(d.to), date, pax: pack.booking.pax, anchor });
  return {
    currentFlight: { flightNo: d.flightNo, farePerTravellerInr: d.farePerPaxInr, departsUtc: d.departAt },
    date,
    note: "In this prototype a flight can move to another time on the same travel day.",
    source: MOCK_SOURCE,
    liveOffers: await liveOffers(String(d.from), String(d.to), date, pack.booking.pax),
    alternatives: alts.filter((a) => a.id !== d.flightId && a.available).slice(0, 6).map((a) => ({
      flightId: a.id, flightNo: a.flightNo, carrier: a.carrierName, departsUtc: a.departAt, departsLocal: localTime(new Date(a.departAt), f.from_tz), arrivesLocal: localTime(new Date(a.arriveAt), f.to_tz),
      farePerTravellerInr: a.farePerPaxInr, differenceVsCurrentInr: a.farePerPaxInr - Number(d.farePerPaxInr), changeFeeInr: a.changeFeeInr, seatsLeft: a.seatsLeft,
      changeCostInr: (Math.max(0, a.farePerPaxInr - Number(d.farePerPaxInr)) + a.changeFeeInr) * pack.booking.pax,
    })),
  };
}

/** Offers from enabled REAL providers (official APIs, user-supplied keys). Empty when only the mock is on. */
async function liveOffers(from: string, to: string, date: string, pax: number) {
  const out: { provider: string; source: string; validUntil: string; summary: string; totalInr: number; breakup: unknown }[] = [];
  for (const p of flightProviders().filter((x) => x.name !== "mock")) {
    try { for (const o of await p.search({ from, to, date, pax })) out.push({ provider: o.provider, source: o.source, validUntil: o.validUntil, summary: o.summary, totalInr: o.totalInr, breakup: o.breakup }); } catch { /* provider down: skip it */ }
  }
  return out;
}

export async function searchStaysTool(ctx: ToolCtx, input: { extraNights: number }) {
  const db = await getDb();
  const items = await db.select().from(s.bookingItems).where(and(eq(s.bookingItems.bookingId, ctx.bookingId), eq(s.bookingItems.kind, "hotel"), eq(s.bookingItems.status, "confirmed")));
  const last = items.sort((a, b) => String(a.details.checkinDate).localeCompare(String(b.details.checkinDate))).at(-1);
  if (!last) throw new GateError("NOT_FOUND", 404, "No hotel on this booking.");
  const d = last.details as Record<string, string | number>;
  const a = await stayAvailability({ hotelId: String(d.hotelId), checkin: String(d.checkoutDate), nights: input.extraNights, rooms: Number(d.rooms) });
  return { hotel: d.name, currentCheckOut: d.checkoutDate, newCheckOut: addDays(String(d.checkoutDate), input.extraNights), available: a.available, rooms: d.rooms, perNight: a.perNight, hotelTotalInr: a.totalInr, note: "Extending the last stop also moves your return flight and airport drop-off. quote_change prices all of it." };
}

export async function quoteChange(ctx: ToolCtx, input: { kind: "flight_change" | "hotel_extend"; itemId?: string; newFlightId?: string; newFlightIds?: string[]; extraNights?: number }) {
  const ids = input.kind === "flight_change" ? (input.newFlightIds?.length ? input.newFlightIds : input.newFlightId ? [input.newFlightId] : []).slice(0, 3) : [undefined];
  const cards: ReviewCard[] = [];
  let lastErr: unknown;
  for (const nf of ids) {
    try {
      const card = await createQuote({ bookingRef: ctx.bookingRef, userId: ctx.userId, kind: input.kind, params: { itemId: input.itemId, newFlightId: nf, extraNights: input.extraNights } as never, chaos: ctx.chaos });
      cards.push(card);
      ctx.ui({ t: "review", card });
    } catch (e) { lastErr = e; }
  }
  if (!cards.length) throw lastErr ?? new GateError("BAD_REQUEST", 400, "Nothing to quote.");
  const allBlocked = cards.every((c) => c.blocked);
  return {
    options: cards.map((c) => ({ quoteId: c.quoteId, blocked: c.blocked, price: inr(c.totalInr), totalInr: c.totalInr, breakup: c.breakup, source: c.source, validUntil: c.validUntil, after: c.after, rules: c.rules })),
    before: cards[0].before,
    next: allBlocked ? "Every option is above the price limit. Call escalate_human instead of asking the traveller to confirm." : "An option list is now on the traveller's screen, each with its price breakup and Yes / No. Tell them to compare and tap Yes on one. You cannot confirm for them.",
  };
}

export async function applyChangeTool(ctx: ToolCtx, input: { quoteId: string }) {
  try {
    const receipt = await applyChange({ quoteId: input.quoteId, token: ctx.confirmationToken, userId: ctx.userId, threadId: ctx.threadId });
    ctx.ui({ t: "receipt", receipt });
    return { applied: true, receipt };
  } catch (e) {
    if (e instanceof GateError && e.code === "PRICE_CHANGED") {
      const card = (e.extra as { newQuote: ReviewCard }).newQuote;
      ctx.ui({ t: "review", card });
      return { applied: false, error: "PRICE_CHANGED", message: "The price moved. A new review card is on screen. Explain the change.", newPriceDeltaInr: card.priceDeltaInr };
    }
    if (e instanceof GateError && e.code === "NO_TOKEN") {
      return { applied: false, error: "CONFIRMATION_REQUIRED", message: "Nothing changed. Only the traveller's Confirm tap on the review card can apply a change. Ask them to tap Confirm." };
    }
    throw e;
  }
}

export async function escalateHuman(ctx: ToolCtx, input: { summary: string; severity?: number }) {
  const rubric = rateSeverity(input.summary).severity;
  const claimed = [1, 2, 3].includes(Number(input.severity)) ? (Number(input.severity) as Severity) : 3;
  const severity = Math.min(rubric, claimed) as Severity; // the more severe of rubric and model
  const c = await openCase({ bookingId: ctx.bookingId, channel: ctx.channel, severity, summary: input.summary });
  ctx.ui({ t: "case", caseRef: c.caseRef, severity, slaSeconds: SLA_SECONDS[severity], summary: input.summary });
  return {
    caseRef: c.caseRef, severity, targetResponseSeconds: SLA_SECONDS[severity],
    message: severity === 1 ? "A person has been paged. Tell the traveller you will stay with them, but you cannot close this case: only a human can." : "A person on our team will follow up.",
    agentMayCloseCase: false,
  };
}

export async function sendSms(ctx: ToolCtx, input: { body: string }) {
  const db = await getDb();
  const [u] = await db.select().from(s.users).where(eq(s.users.id, ctx.userId));
  if (!u?.phoneE164) throw new GateError("NOT_FOUND", 404, "No registered phone number for this traveller.");
  const body = input.body.slice(0, 160);
  const r = await getSmsAdapter().send(u.phoneE164, body);
  await db.insert(s.smsMessages).values({ providerMessageId: r.id, direction: "out", fromMasked: maskPhone(u.phoneE164), body });
  return { sent: true, to: maskPhone(u.phoneE164), length: body.length, simulated: r.stub };
}

/* ------------------------------ AI SDK wiring ------------------------------ */

const Id = z.string().uuid();
export const SCHEMAS = {
  get_itinerary: z.object({}),
  get_route: z.object({ from: z.string().max(80).optional().describe("Place name, or 'hotel' / 'airport'. Defaults to the hotel."), to: z.string().max(80).describe("Place name, or 'hotel' / 'airport'.") }),
  search_flights: z.object({ itemId: Id.describe("Booked flight itemId from get_itinerary"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  search_stays: z.object({ extraNights: z.number().int().min(1).max(3) }),
  search_web: z.object({ query: z.string().min(3).max(200).describe("A travel information question, e.g. visa rules or opening hours") }),
  quote_change: z.object({ kind: z.enum(["flight_change", "hotel_extend"]), itemId: Id.optional().describe("flight_change: booked flight itemId"), newFlightId: Id.optional().describe("flight_change: one flightId from search_flights"), newFlightIds: z.array(Id).min(1).max(3).optional().describe("flight_change: up to 3 flightIds to show as an option list"), extraNights: z.number().int().min(1).max(3).optional().describe("hotel_extend: nights to add") }),
  apply_change: z.object({ quoteId: Id }),
  refresh_offline_pack: z.object({}),
  escalate_human: z.object({ summary: z.string().min(3).max(400), severity: z.number().int().min(1).max(3).optional() }),
  send_sms: z.object({ body: z.string().min(1).max(160) }),
} as const;

export const DESCRIPTIONS: Record<ToolName, string> = {
  get_itinerary: "Read the traveller's trip: next plans, pickup, hotel, local time, flights (with itemId). Call this first for any trip question.",
  get_route: "Get a saved map route and steps between two places on the trip (e.g. hotel to Colosseum).",
  search_flights: "Find alternative flights for a booked flight on the same route and day.",
  search_stays: "Check availability to extend the stay at the last hotel by 1 to 3 nights.",
  search_web: "Look up general travel information with a web search API. Cites sources. Never a booking price.",
  quote_change: "Price a change and show the traveller an option list with a price breakup and Yes / No. For a flight pass up to 3 newFlightIds. Does NOT change anything.",
  apply_change: "Apply a quoted change. Needs the traveller's Confirm tap; without it this does nothing. Never claim a change is done unless this returns applied: true.",
  refresh_offline_pack: "Server-side job (not callable by the model): regenerates the affected offline guide rules after a confirmed change.",
  escalate_human: "Open a case for a human agent. Use for safety, medical, lost passport, stranded, missed connection, no-show, anything over the price limit, or missing data.",
  send_sms: "Send a short SMS (max 160 characters) to the traveller's registered phone.",
};

/** Run any tool by name with validated input. Shared by the LLM path and the demo agent. */
export async function runTool(name: ToolName, rawInput: unknown, ctx: ToolCtx, opts: { internal?: boolean } = {}) {
  if (name === "refresh_offline_pack" && !opts.internal) throw new GateError("FORBIDDEN", 403, "refresh_offline_pack is a server-side job. It runs only after apply_change succeeds.");
  const input = SCHEMAS[name].parse(rawInput ?? {}) as never;
  return logged(ctx, name, input, async () => {
    switch (name) {
      case "get_itinerary": return getItinerary(ctx);
      case "get_route": return getRoute(ctx, input);
      case "search_flights": return searchFlightsTool(ctx, input);
      case "search_stays": return searchStaysTool(ctx, input);
      case "search_web": return searchWeb((input as { query: string }).query);
      case "refresh_offline_pack": return refreshOfflinePack(ctx.bookingId, "Manual refresh");
      case "quote_change": return quoteChange(ctx, input);
      case "apply_change": return applyChangeTool(ctx, input);
      case "escalate_human": return escalateHuman(ctx, input);
      case "send_sms": return sendSms(ctx, input);
    }
  });
}

/** The fixed allow-list handed to the model. There is no tool that can mint a confirmation token. */
export function aiTools(ctx: ToolCtx, allow: readonly ToolName[] = MODEL_TOOLS) {
  const out: Record<string, any> = {};
  for (const name of allow) {
    out[name] = tool({ description: DESCRIPTIONS[name], inputSchema: SCHEMAS[name] as never, execute: async (input: unknown) => runTool(name, input, ctx) } as never);
  }
  return out;
}
