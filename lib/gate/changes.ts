import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { flightDetails } from "@/lib/server/booking";
import { refreshOfflinePack } from "@/lib/packs/refresh";
import { assertBreakup, type Breakup } from "@/lib/providers/types";
import { MOCK_SOURCE } from "@/lib/providers/mock";
import { isPlatformId, PLATFORMS, type PlatformId } from "@/lib/providers/platforms";
import { addDays, fmtDate, inr, localDate, localTime, zonedToUtc } from "@/lib/time";
import { ORIGINS } from "@/lib/seed/data";
import { GateError } from "./errors";
import { hashToken, mintToken, quoteHash, QUOTE_TTL_MS, safeEqual, TOKEN_TTL_MS } from "./tokens";

export type ChangeKind = "flight_change" | "hotel_extend" | "flight_external";
export type Card = { title: string; lines: { label: string; value: string }[] };
export type ReviewCard = {
  quoteId: string;
  bookingRef: string;
  kind: ChangeKind;
  title: string;
  before: Card;
  after: Card;
  priceDeltaInr: number;
  rules: string[];
  expiresAt: string;
  blocked: boolean;
  blockedReason?: string;
  notice: string;
  chaos?: string | null;
  /** Every line of the price, in ₹. Total equals the sum of the lines. */
  breakup: Breakup[];
  totalInr: number;
  source: string;
  validUntil: string;
  refundable: boolean;
};
export type Receipt = {
  receiptId: string;
  bookingRef: string;
  kind: ChangeKind;
  summary: string;
  priceDeltaInr: number;
  newTotalInr: number;
  appliedAt: string;
  packVersion: number;
  /** Offline guide refresh after the change (spec section 7). */
  guide: { updated: boolean; regenerated: string[]; origin?: string; message: string };
};

export const priceLimit = () => Number(process.env.PRICE_LIMIT_INR ?? 25000);
export const REVIEW_NOTICE = "Nothing is booked until you tap Confirm.";
export const EXTERNAL_NOTICE = "Safar Saathi books and charges nothing here. You already changed the ticket on the platform. Confirm only updates your trip and offline guide.";
/** A change you made yourself on a booking platform is a record, not a charge by us: the price limit protects what WE would book. */
const limited = (kind: string) => kind !== "flight_external";
const sourceOf = (kind: string, params: Record<string, unknown>) => (kind === "flight_external" && isPlatformId(params.platform) ? `Entered by you from ${PLATFORMS[params.platform].name}. Not verified by Safar Saathi` : MOCK_SOURCE);

type Params = Record<string, unknown>;
type Computed = {
  before: Card;
  after: Card;
  priceDeltaInr: number;
  breakup: Breakup[];
  rules: string[];
  plan:
    | { type: "flight_external"; itemId: string; platform: PlatformId; flightNo: string; carrierName: string; departAt: string; arriveAt: string; pnr: string; leg: string; fareDiffInr: number; feeInr: number }
    | { type: "flight_change"; itemId: string; newFlightId: string; pnr: string; leg: string; newFarePerPax: number; oldFlightId: string }
    | { type: "hotel_extend"; hotelItemId: string; dropItemId?: string; flightItemId: string; newFlightId: string; oldFlightId: string; extraNights: number; newEnd: string; hotelCost: number; newFarePerPax: number; pnr: string; roomsNeeded: number; hotelId: string; checkoutDate: string };
};

const tzOf = (iata: string, cityTz: Map<string, string>) => cityTz.get(iata) ?? ORIGINS[iata]?.tz ?? "UTC";
const hhmm = (d: Date, tz: string) => localTime(d, tz);
const flightCard = (title: string, f: { flightNo: string; carrierName: string; fromIata: string; toIata: string; departAt: Date; arriveAt: Date; fareInr: number }, tzs: Map<string, string>): Card => ({
  title,
  lines: [
    { label: "Flight", value: `${f.carrierName} ${f.flightNo}` },
    { label: "Route", value: `${f.fromIata} to ${f.toIata}` },
    { label: "Departs", value: `${fmtDate(localDate(f.departAt, tzOf(f.fromIata, tzs)))}, ${hhmm(f.departAt, tzOf(f.fromIata, tzs))}` },
    { label: "Arrives", value: `${fmtDate(localDate(f.arriveAt, tzOf(f.toIata, tzs)))}, ${hhmm(f.arriveAt, tzOf(f.toIata, tzs))}` },
    { label: "Fare per traveller", value: inr(f.fareInr) },
  ],
});

async function tzMap(db: Db, itineraryId: string) {
  const [it] = await db.select().from(s.itineraries).where(eq(s.itineraries.id, itineraryId));
  const ds = await db.select().from(s.destinations).where(inArray(s.destinations.slug, it.cities));
  return new Map<string, string>(ds.map((d) => [d.airportIata, d.timezone]));
}

/** Pure(ish) price + availability computation. Used for quoting AND re-checking at apply time. */
export async function computeChange(db: Db, booking: typeof s.bookings.$inferSelect, kind: ChangeKind, params: Params): Promise<Computed> {
  const bump = 1 + Number(params.bumpPct ?? 0) / 100;
  const tzs = await tzMap(db, booking.itineraryId);
  const items = await db.select().from(s.bookingItems).where(and(eq(s.bookingItems.bookingId, booking.id), eq(s.bookingItems.status, "confirmed")));

  if (kind === "flight_change") {
    const itemId = String(params.itemId ?? "");
    const newFlightId = String(params.newFlightId ?? "");
    const item = items.find((i) => i.id === itemId && i.kind === "flight");
    if (!item) throw new GateError("NOT_FOUND", 404, "That flight is not on this booking.");
    const [nf] = await db.select().from(s.flights).where(eq(s.flights.id, newFlightId)).limit(1);
    const d = item.details as Record<string, string | number>;
    if (!nf) throw new GateError("NOT_FOUND", 404, "That replacement flight does not exist.");
    if (nf.fromIata !== d.from || nf.toIata !== d.to) throw new GateError("BAD_REQUEST", 400, "The replacement flight must fly the same route.");
    const oldDepart = new Date(String(d.departAt));
    if (oldDepart.getTime() - Date.now() < 3 * 3600e3) throw new GateError("CHANGE_WINDOW_CLOSED", 409, "Changes are not allowed within 3 hours of departure.");
    if (nf.seatsLeft < booking.pax) throw new GateError("NO_AVAILABILITY", 409, `Only ${nf.seatsLeft} seats left on that flight.`);
    const fromTz = tzOf(String(d.from), tzs), toTz = tzOf(String(d.to), tzs);
    const sameDay = d.leg === "outbound" ? localDate(nf.arriveAt, toTz) === localDate(new Date(String(d.arriveAt)), toTz) : localDate(nf.departAt, fromTz) === localDate(oldDepart, fromTz);
    if (!sameDay) throw new GateError("BAD_REQUEST", 400, "In this prototype a flight can move to another time on the same travel day.");
    const newFare = Math.round((nf.fareInr * bump) / 50) * 50;
    const fee = Number(d.changeFeeInr ?? nf.changeFeeInr);
    const diff = Math.max(0, newFare - Number(d.farePerPaxInr));
    const breakup: Breakup[] = [
      { label: `Fare difference (₹${diff} per person × ${booking.pax})`, amountInr: diff * booking.pax },
      { label: `Change fee (₹${fee} per person × ${booking.pax})`, amountInr: fee * booking.pax },
    ];
    const delta = breakup.reduce((a, l) => a + l.amountInr, 0);
    assertBreakup(breakup, delta);
    return {
      before: flightCard("Your current flight", { flightNo: String(d.flightNo), carrierName: String(d.carrierName), fromIata: String(d.from), toIata: String(d.to), departAt: oldDepart, arriveAt: new Date(String(d.arriveAt)), fareInr: Number(d.farePerPaxInr) }, tzs),
      after: flightCard("New flight", { ...nf, fareInr: newFare }, tzs),
      priceDeltaInr: delta,
      breakup,
      rules: [
        `Change fee ${inr(fee)} per traveller, plus any fare difference (${inr(diff)} per traveller). ${booking.pax} travellers.`,
        "Sample fare rules: changes are not allowed within 3 hours of departure. A cheaper new fare is not refunded.",
      ],
      plan: { type: "flight_change", itemId, newFlightId, pnr: String(d.pnr), leg: String(d.leg), newFarePerPax: newFare, oldFlightId: String(d.flightId) },
    };
  }

  if (kind === "flight_external") {
    const bad = (m: string) => new GateError("BAD_REQUEST", 400, m);
    if (!isPlatformId(params.platform)) throw bad("Choose MakeMyTrip, Goibibo, Cleartrip or ixigo.");
    const platform = params.platform;
    const item = items.find((i) => i.id === String(params.itemId ?? "") && i.kind === "flight");
    if (!item) throw new GateError("NOT_FOUND", 404, "That flight is not on this booking.");
    const d = item.details as Record<string, string | number>;
    const flightNo = String(params.flightNo ?? "").toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z0-9]{2}\d{1,4}$/.test(flightNo)) throw bad("Enter the flight number as on your ticket, like AI 143.");
    const carrierName = String(params.carrierName ?? "").trim().slice(0, 40);
    if (carrierName.length < 2) throw bad("Enter the airline name.");
    const pnr = String(params.pnr ?? "").toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z0-9]{5,8}$/.test(pnr)) throw bad("Enter the booking code (PNR) from the airline or platform, 5 to 8 letters or digits.");
    const fareDiff = Number(params.fareDiffInr ?? 0), fee = Number(params.changeFeeInr ?? 0);
    for (const n of [fareDiff, fee]) if (!Number.isInteger(n) || n < 0 || n > 500000) throw bad("Amounts must be whole rupees from 0 to 5,00,000.");
    const parse = (v: unknown, tz: string) => {
      const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(String(v ?? ""));
      if (!m) throw bad("Enter the date and time of the new flight.");
      return zonedToUtc(m[1], m[2], tz);
    };
    const fromTz = tzOf(String(d.from), tzs), toTz = tzOf(String(d.to), tzs);
    const nd = parse(params.departLocal, fromTz), na = parse(params.arriveLocal, toTz);
    const oldDepart = new Date(String(d.departAt));
    if (Number.isNaN(nd.getTime()) || Number.isNaN(na.getTime())) throw bad("Enter a valid date and time.");
    if (na.getTime() <= nd.getTime()) throw bad("The new flight must arrive after it departs.");
    if (nd.getTime() < Date.now()) throw bad("The new flight has already left. Check the date.");
    if (Math.abs(nd.getTime() - oldDepart.getTime()) > 7 * 86400e3) throw bad("The new flight must be within 7 days of your old one. For anything bigger, talk to our team.");
    const label = PLATFORMS[platform].name;
    const breakup: Breakup[] = [
      { label: `Fare difference you paid on ${label}`, amountInr: fareDiff },
      { label: `Change fee you paid on ${label}`, amountInr: fee },
    ];
    const delta = fareDiff + fee;
    assertBreakup(breakup, delta);
    const newCard: Card = {
      title: "New flight (from your ticket)",
      lines: [
        { label: "Flight", value: `${carrierName} ${flightNo}` },
        { label: "Route", value: `${d.from} to ${d.to}` },
        { label: "Departs", value: `${fmtDate(localDate(nd, fromTz))}, ${hhmm(nd, fromTz)}` },
        { label: "Arrives", value: `${fmtDate(localDate(na, toTz))}, ${hhmm(na, toTz)}` },
        { label: "Booking code", value: pnr },
        { label: "Changed on", value: label },
      ],
    };
    return {
      before: flightCard("Your current flight", { flightNo: String(d.flightNo), carrierName: String(d.carrierName), fromIata: String(d.from), toIata: String(d.to), departAt: oldDepart, arriveAt: new Date(String(d.arriveAt)), fareInr: Number(d.farePerPaxInr) }, tzs),
      after: newCard,
      priceDeltaInr: delta,
      breakup,
      rules: [
        `You changed this ticket on ${label} yourself and paid there. Safar Saathi did not book, pay for or check it: we record exactly what you entered so your plan, pickup time and offline guide match your new flight.`,
        "Before you confirm, compare these details with the airline's confirmation email or SMS. If they differ, tap No and enter them again.",
      ],
      plan: { type: "flight_external", itemId: item.id, platform, flightNo, carrierName, departAt: nd.toISOString(), arriveAt: na.toISOString(), pnr, leg: String(d.leg), fareDiffInr: fareDiff, feeInr: fee },
    };
  }

  // hotel_extend: last stop only; the return flight and drop transfer move with it.
  const extra = Number(params.extraNights ?? 0);
  if (!Number.isInteger(extra) || extra < 1 || extra > 3) throw new GateError("BAD_REQUEST", 400, "You can extend by 1 to 3 nights.");
  const hotelItems = items.filter((i) => i.kind === "hotel").sort((a, b) => String(a.details.checkinDate).localeCompare(String(b.details.checkinDate)));
  const hotelItem = hotelItems[hotelItems.length - 1];
  const retItem = items.find((i) => i.kind === "flight" && i.details.leg === "return");
  if (!hotelItem || !retItem) throw new GateError("NOT_FOUND", 404, "No hotel or return flight on this booking.");
  const hd = hotelItem.details as Record<string, string | number>;
  const rd = retItem.details as Record<string, string | number>;
  const checkoutDate = String(hd.checkoutDate);
  const newEnd = addDays(checkoutDate, extra);
  const rooms = Number(hd.rooms);
  const inv = await db
    .select()
    .from(s.roomInventory)
    .where(and(eq(s.roomInventory.hotelId, String(hd.hotelId)), eq(s.roomInventory.roomType, "standard"), gte(s.roomInventory.date, checkoutDate), lt(s.roomInventory.date, newEnd)))
    .orderBy(asc(s.roomInventory.date));
  if (inv.length < extra || inv.some((r) => r.roomsLeft < rooms)) throw new GateError("NO_AVAILABILITY", 409, `${hd.name} does not have ${rooms} rooms free for all of those nights.`);
  const hotelCost = Math.round(inv.reduce((a, r) => a + r.priceInr, 0) * rooms * bump);

  const retTz = tzOf(String(rd.from), tzs);
  const oldDep = new Date(String(rd.departAt));
  const oldLocal = hhmm(oldDep, retTz);
  const [lo, hi] = [zonedToUtc(newEnd, "00:00", retTz), zonedToUtc(addDays(newEnd, 1), "00:00", retTz)];
  const cands = await db
    .select()
    .from(s.flights)
    .where(and(eq(s.flights.fromIata, String(rd.from)), eq(s.flights.toIata, String(rd.to)), gte(s.flights.departAt, lo), lt(s.flights.departAt, hi)));
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  // Cheapest seat-available flight that day; ties go to the one closest to the old departure time.
  const usable = cands.filter((c) => c.seatsLeft >= booking.pax).sort((a, b) => a.fareInr - b.fareInr || Math.abs(m(hhmm(a.departAt, retTz)) - m(oldLocal)) - Math.abs(m(hhmm(b.departAt, retTz)) - m(oldLocal)));
  const nf = usable[0];
  if (!nf) throw new GateError("NO_AVAILABILITY", 409, `No return flight with ${booking.pax} seats on ${fmtDate(newEnd)}.`);
  const newFare = Math.round((nf.fareInr * bump) / 50) * 50;
  const fee = Number(rd.changeFeeInr ?? nf.changeFeeInr);
  const flightDelta = (Math.max(0, newFare - Number(rd.farePerPaxInr)) + fee) * booking.pax;
  const extraBreakup: Breakup[] = [
    { label: `Extra hotel nights (${extra} night${extra > 1 ? "s" : ""} × ${rooms} room${rooms > 1 ? "s" : ""})`, amountInr: hotelCost },
    { label: `Return flight fare difference (₹${Math.max(0, newFare - Number(rd.farePerPaxInr))} per person × ${booking.pax})`, amountInr: Math.max(0, newFare - Number(rd.farePerPaxInr)) * booking.pax },
    { label: `Return flight change fee (₹${fee} per person × ${booking.pax})`, amountInr: fee * booking.pax },
  ];
  const extraTotal = extraBreakup.reduce((a, l) => a + l.amountInr, 0);
  assertBreakup(extraBreakup, extraTotal);
  const dropItem = items.find((i) => i.kind === "transfer" && i.details.type === "drop" && i.details.city === hd.city);
  return {
    before: {
      title: "Your stay now",
      lines: [
        { label: "Hotel", value: String(hd.name) },
        { label: "Check out", value: fmtDate(checkoutDate) },
        { label: "Return flight", value: `${rd.carrierName} ${rd.flightNo}, ${fmtDate(localDate(oldDep, retTz))} ${oldLocal}` },
      ],
    },
    after: {
      title: `Stay ${extra} more night${extra > 1 ? "s" : ""}`,
      lines: [
        { label: "Hotel", value: String(hd.name) },
        { label: "Check out", value: fmtDate(newEnd) },
        { label: "Return flight (moved)", value: `${nf.carrierName} ${nf.flightNo}, ${fmtDate(localDate(nf.departAt, retTz))} ${hhmm(nf.departAt, retTz)}` },
        { label: "Extra hotel cost", value: `${inr(hotelCost)} for ${rooms} room${rooms > 1 ? "s" : ""}` },
        { label: "Flight change cost", value: inr(flightDelta) },
      ],
    },
    priceDeltaInr: extraTotal,
    breakup: extraBreakup,
    rules: [
      `Extra nights are priced from today's sample room rates. Return flight change: ${inr(fee)} per traveller plus any fare difference.`,
      "Your airport drop-off moves to the new day. Your offline pack will update after you confirm.",
    ],
    plan: { type: "hotel_extend", hotelItemId: hotelItem.id, dropItemId: dropItem?.id, flightItemId: retItem.id, newFlightId: nf.id, oldFlightId: String(rd.flightId), extraNights: extra, newEnd, hotelCost, newFarePerPax: newFare, pnr: String(rd.pnr), roomsNeeded: rooms, hotelId: String(hd.hotelId), checkoutDate },
  };
}

function toCard(q: typeof s.changeQuotes.$inferSelect, bookingRef: string): ReviewCard {
  const over = limited(q.kind) && Math.abs(q.priceDeltaInr) > priceLimit();
  const title = q.kind === "flight_change" ? "Change your flight" : q.kind === "flight_external" ? "Record your flight change" : "Extend your stay";
  return {
    quoteId: q.id, bookingRef, kind: q.kind as ChangeKind, title, before: q.before as unknown as Card, after: q.after as unknown as Card,
    priceDeltaInr: q.priceDeltaInr, rules: q.rules, expiresAt: q.expiresAt.toISOString(), blocked: over,
    blockedReason: over ? `This change costs more than ${inr(priceLimit())}. A person on our team must handle it.` : undefined,
    notice: q.kind === "flight_external" ? EXTERNAL_NOTICE : REVIEW_NOTICE, chaos: q.chaos,
    breakup: q.breakup, totalInr: q.priceDeltaInr, source: q.source, validUntil: q.expiresAt.toISOString(), refundable: false,
  };
}

async function loadOwnedBooking(db: Db, bookingRef: string, userId: string) {
  const [b] = await db.select().from(s.bookings).where(eq(s.bookings.ref, bookingRef)).limit(1);
  if (!b) throw new GateError("NOT_FOUND", 404, "Booking not found.");
  if (b.userId !== userId) throw new GateError("FORBIDDEN", 403, "That booking belongs to someone else.");
  return b;
}

export async function createQuote(input: { bookingRef: string; userId: string; kind: ChangeKind; params: Params; chaos?: string | null }, dbIn?: Db): Promise<ReviewCard> {
  const db = dbIn ?? (await getDb());
  const booking = await loadOwnedBooking(db, input.bookingRef, input.userId);
  if (booking.status !== "confirmed") throw new GateError("NOT_BOOKED", 409, "Book this trip first. Changes apply to a booked trip.");
  const params = JSON.parse(JSON.stringify(input.params)) as Params; // drop undefined: what we hash must equal what JSONB stores
  const c = await computeChange(db, booking, input.kind, params);
  assertBreakup(c.breakup, c.priceDeltaInr);
  const core = { bookingId: booking.id, kind: input.kind, params, before: c.before, after: c.after, priceDeltaInr: c.priceDeltaInr, breakup: c.breakup };
  const q = await db.transaction(async (tx0) => {
    const tx = tx0 as unknown as Db;
    const [row] = await tx
      .insert(s.changeQuotes)
      .values({
        bookingId: booking.id, userId: input.userId, kind: input.kind, params, before: c.before as never, after: c.after as never,
        priceDeltaInr: c.priceDeltaInr, rules: c.rules, status: "open", chaos: input.chaos ?? null, expiresAt: new Date(Date.now() + QUOTE_TTL_MS), quoteHash: quoteHash(core),
        source: sourceOf(input.kind, params), breakup: c.breakup,
      })
      .returning();
    await tx.insert(s.priceBreakups).values(c.breakup.map((l) => ({ quoteId: row.id, label: l.label, amountInr: l.amountInr })));
    return row;
  });
  return toCard(q, booking.ref);
}

async function loadQuote(db: Db, quoteId: string) {
  const [q] = await db.select().from(s.changeQuotes).where(eq(s.changeQuotes.id, quoteId)).limit(1);
  if (!q) throw new GateError("QUOTE_NOT_FOUND", 404, "Quote not found.");
  return q;
}

const tampered = (q: typeof s.changeQuotes.$inferSelect) =>
  !safeEqual(q.quoteHash, quoteHash({ bookingId: q.bookingId, kind: q.kind, params: q.params, before: q.before, after: q.after, priceDeltaInr: q.priceDeltaInr, breakup: q.breakup }));

/** Step 3 of the gate: only a human Confirm tap (an authenticated request) can mint a token. */
export async function issueConfirmation(input: { quoteId: string; userId: string }, dbIn?: Db): Promise<{ token: string; expiresAt: string }> {
  const db = dbIn ?? (await getDb());
  const q = await loadQuote(db, input.quoteId);
  if (q.userId !== input.userId) throw new GateError("FORBIDDEN", 403, "That quote belongs to someone else.");
  if (q.status !== "open") throw new GateError("QUOTE_NOT_OPEN", 409, `This quote is ${q.status}.`);
  if (q.expiresAt.getTime() < Date.now()) throw new GateError("QUOTE_EXPIRED", 410, "This quote has expired. Ask for a new one.");
  if (tampered(q)) throw new GateError("QUOTE_TAMPERED", 409, "This quote no longer matches what was shown.");
  if (limited(q.kind) && Math.abs(q.priceDeltaInr) > priceLimit()) throw new GateError("OVER_LIMIT", 403, `Changes above ${inr(priceLimit())} need a person on our team.`);
  const { token, tokenHash } = mintToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await db.transaction(async (tx) => {
    // void any older unused token for this quote
    await tx.update(s.confirmations).set({ usedAt: new Date() }).where(and(eq(s.confirmations.quoteId, q.id), isNull(s.confirmations.usedAt)));
    await tx.insert(s.confirmations).values({ quoteId: q.id, tokenHash, userId: input.userId, expiresAt });
    await tx.insert(s.toolCalls).values({ bookingId: q.bookingId, tool: "traveller_confirm", input: { quoteId: q.id }, output: { tokenIssued: true }, status: "ok" });
  });
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function declineQuote(input: { quoteId: string; userId: string }, dbIn?: Db) {
  const db = dbIn ?? (await getDb());
  const q = await loadQuote(db, input.quoteId);
  if (q.userId !== input.userId) throw new GateError("FORBIDDEN", 403, "That quote belongs to someone else.");
  await db.update(s.changeQuotes).set({ status: "declined", updatedAt: new Date() }).where(and(eq(s.changeQuotes.id, q.id), eq(s.changeQuotes.status, "open")));
  await db.insert(s.toolCalls).values({ bookingId: q.bookingId, tool: "traveller_decline", input: { quoteId: q.id }, output: { changed: false }, status: "ok" });
  return { declined: true };
}

type ApplyResult = { ok: true; receipt: Omit<Receipt, "packVersion" | "guide"> } | { ok: false; newQuote: ReviewCard };

/**
 * Steps 4–8 of the gate. Requires a valid single-use confirmation token; with none, a reused,
 * expired or foreign token, nothing changes.
 */
export async function applyChange(input: { quoteId: string; token?: string | null; userId: string; threadId?: string | null }, dbIn?: Db): Promise<Receipt> {
  const db = dbIn ?? (await getDb());
  if (!input.token) {
    await db.insert(s.toolCalls).values({ tool: "apply_change", input: { quoteId: input.quoteId }, output: { error: "NO_TOKEN" }, status: "blocked" }).catch(() => {});
    throw new GateError("NO_TOKEN", 401, "A change needs your Confirm tap. Nothing was changed.");
  }
  const tokenHash = hashToken(input.token);
  const result: ApplyResult | GateError = await db.transaction(async (tx0) => {
    const tx = tx0 as unknown as Db;
    const [conf] = await tx.select().from(s.confirmations).where(eq(s.confirmations.tokenHash, tokenHash)).limit(1);
    if (!conf) return new GateError("TOKEN_INVALID", 401, "That confirmation is not valid. Nothing was changed.");
    if (conf.userId !== input.userId) return new GateError("TOKEN_MISMATCH", 403, "That confirmation belongs to someone else.");
    if (conf.quoteId !== input.quoteId) return new GateError("TOKEN_MISMATCH", 403, "That confirmation is for a different change.");
    if (conf.usedAt) return new GateError("TOKEN_USED", 409, "That confirmation was already used.");
    if (conf.expiresAt.getTime() < Date.now()) return new GateError("TOKEN_EXPIRED", 401, "That confirmation expired. Tap Confirm again.");
    // Atomic single-use claim: only one caller can flip used_at from NULL.
    const claimed = await tx
      .update(s.confirmations)
      .set({ usedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(s.confirmations.id, conf.id), isNull(s.confirmations.usedAt), sql`${s.confirmations.expiresAt} > now()`))
      .returning({ id: s.confirmations.id });
    if (!claimed.length) return new GateError("TOKEN_USED", 409, "That confirmation was already used.");

    const q = await loadQuote(tx, conf.quoteId);
    if (q.status !== "open") return new GateError("QUOTE_NOT_OPEN", 409, `This quote is ${q.status}.`);
    if (q.expiresAt.getTime() < Date.now()) return new GateError("QUOTE_EXPIRED", 410, "This quote has expired.");
    if (tampered(q)) return new GateError("QUOTE_TAMPERED", 409, "This quote no longer matches what was shown.");
    if (limited(q.kind) && Math.abs(q.priceDeltaInr) > priceLimit()) return new GateError("OVER_LIMIT", 403, `Changes above ${inr(priceLimit())} need a person on our team.`);
    const [booking] = await tx.select().from(s.bookings).where(eq(s.bookings.id, q.bookingId)).limit(1);
    if (booking.userId !== input.userId) return new GateError("FORBIDDEN", 403, "That booking belongs to someone else.");

    // Re-check the live price. Demo chaos: the first apply sees a 5–15% price move.
    const chaosPct = q.chaos === "price_move" && limited(q.kind) ? 5 + (parseInt(q.id.slice(0, 4), 16) % 11) : 0;
    const liveParams = { ...q.params, bumpPct: Number(q.params.bumpPct ?? 0) + chaosPct };
    let live: Computed;
    try {
      live = await computeChange(tx, booking, q.kind as ChangeKind, liveParams);
    } catch (e) {
      return e instanceof GateError ? e : new GateError("BAD_REQUEST", 400, String(e));
    }
    if (live.priceDeltaInr !== q.priceDeltaInr) {
      // Old token is spent and the old quote is void. Issue a fresh quote at the new price.
      await tx.update(s.changeQuotes).set({ status: "void", updatedAt: new Date() }).where(eq(s.changeQuotes.id, q.id));
      const core = { bookingId: booking.id, kind: q.kind, params: liveParams, before: live.before, after: live.after, priceDeltaInr: live.priceDeltaInr, breakup: live.breakup };
      const [nq] = await tx
        .insert(s.changeQuotes)
        .values({ bookingId: booking.id, userId: input.userId, kind: q.kind, params: liveParams, before: live.before as never, after: live.after as never, priceDeltaInr: live.priceDeltaInr, rules: live.rules, status: "open", chaos: null, expiresAt: new Date(Date.now() + QUOTE_TTL_MS), quoteHash: quoteHash(core), source: sourceOf(q.kind, liveParams), breakup: live.breakup })
        .returning();
      await tx.insert(s.priceBreakups).values(live.breakup.map((l) => ({ quoteId: nq.id, label: l.label, amountInr: l.amountInr })));
      await tx.insert(s.toolCalls).values({ bookingId: booking.id, tool: "apply_change", input: { quoteId: q.id }, output: { error: "PRICE_CHANGED", oldDeltaInr: q.priceDeltaInr, newDeltaInr: live.priceDeltaInr, newQuoteId: nq.id }, status: "blocked" });
      return { ok: false, newQuote: toCard(nq, booking.ref) };
    }

    await mutate(tx, booking, live);
    const delta = live.priceDeltaInr;
    const newTotal = booking.totalInr + delta;
    await tx.update(s.bookings).set({ totalInr: newTotal, updatedAt: new Date(), ...(live.plan.type === "hotel_extend" ? { endDate: live.plan.newEnd } : {}) }).where(eq(s.bookings.id, booking.id));
    await tx.insert(s.payments).values(live.plan.type === "flight_external" ? { bookingId: booking.id, method: "external", amountInr: delta, status: "recorded" } : { bookingId: booking.id, method: "dummy", amountInr: delta, status: "paid" });
    await tx.update(s.changeQuotes).set({ status: "applied", updatedAt: new Date() }).where(eq(s.changeQuotes.id, q.id));
    // the other options offered alongside this one are void now: the booking they priced has changed
    await tx.update(s.changeQuotes).set({ status: "void", updatedAt: new Date() }).where(and(eq(s.changeQuotes.bookingId, booking.id), eq(s.changeQuotes.status, "open")));
    const receiptId = `R-${booking.ref.slice(3)}-${String(Date.now()).slice(-5)}`;
    const summary = q.kind === "flight_change" || q.kind === "flight_external" ? `Flight moved to ${(q.after as unknown as Card).lines[0].value}` : `Stay extended to ${(q.after as unknown as Card).lines[1].value}`;
    const receipt = { receiptId, bookingRef: booking.ref, kind: q.kind as ChangeKind, summary, priceDeltaInr: delta, newTotalInr: newTotal, appliedAt: new Date().toISOString() };
    await tx.insert(s.toolCalls).values({ bookingId: booking.id, threadId: input.threadId ?? null, tool: "apply_change", input: { quoteId: q.id }, output: receipt, status: "ok" });
    await tx.insert(s.events).values({ name: "change_applied", userId: input.userId, bookingId: booking.id, props: { receiptId, deltaInr: delta, kind: q.kind } });
    return { ok: true, receipt };
  });

  if (result instanceof GateError) throw result;
  if (!result.ok) throw new GateError("PRICE_CHANGED", 409, "The price moved. Please review the new quote.", { newQuote: result.newQuote });
  // Step 8: rebuild the offline pack from the updated booking.
  const [bk] = await db.select().from(s.bookings).where(eq(s.bookings.ref, result.receipt.bookingRef)).limit(1);
  const refreshed = await refreshOfflinePack(bk.id, result.receipt.summary, db);
  const guide: Receipt["guide"] = refreshed.ok
    ? { updated: refreshed.changed, regenerated: refreshed.regenerated, origin: refreshed.rulesOrigin, message: `Offline guide updated to version ${refreshed.version}.` }
    : { updated: false, regenerated: [], message: "Your offline guide was not updated. The previous version is still active. Your change is saved. Try again from the trip page." };
  return { ...result.receipt, packVersion: refreshed.version, guide };
}

async function mutate(tx: Db, booking: typeof s.bookings.$inferSelect, c: Computed) {
  const p = c.plan;
  const swapFlight = async (itemId: string, newFlightId: string, oldFlightId: string, pnr: string, leg: string) => {
    const [nf] = await tx.select().from(s.flights).where(eq(s.flights.id, newFlightId));
    const [oldItem] = await tx.select().from(s.bookingItems).where(eq(s.bookingItems.id, itemId));
    await tx.update(s.bookingItems).set({ status: "replaced", updatedAt: new Date() }).where(eq(s.bookingItems.id, itemId));
    const details = flightDetails(nf, booking.pax, leg, pnr);
    await tx.insert(s.bookingItems).values({ bookingId: booking.id, kind: "flight", refId: nf.id, date: oldItem.date, details, priceInr: nf.fareInr * booking.pax, status: "confirmed" });
    await tx.update(s.flights).set({ seatsLeft: sql`${s.flights.seatsLeft} - ${booking.pax}` }).where(eq(s.flights.id, nf.id));
    await tx.update(s.flights).set({ seatsLeft: sql`${s.flights.seatsLeft} + ${booking.pax}` }).where(eq(s.flights.id, oldFlightId));
    return nf;
  };
  if (p.type === "flight_external") {
    const [oldItem] = await tx.select().from(s.bookingItems).where(eq(s.bookingItems.id, p.itemId));
    const od = oldItem.details as Record<string, unknown>;
    await tx.update(s.bookingItems).set({ status: "replaced", updatedAt: new Date() }).where(eq(s.bookingItems.id, p.itemId));
    const details = {
      ...od, flightId: null, flightNo: p.flightNo, carrierName: p.carrierName, departAt: p.departAt, arriveAt: p.arriveAt, pnr: p.pnr, leg: p.leg,
      farePerPaxInr: Number(od.farePerPaxInr ?? 0) + Math.round(p.fareDiffInr / booking.pax), changeFeeInr: Math.round(p.feeInr / booking.pax),
      fareRules: `Changed on ${PLATFORMS[p.platform].name}. The airline's and the platform's rules apply.`, externalPlatform: p.platform, enteredByTraveller: true,
    };
    await tx.insert(s.bookingItems).values({ bookingId: booking.id, kind: "flight", refId: null, date: oldItem.date, details, priceInr: oldItem.priceInr + p.fareDiffInr + p.feeInr, status: "confirmed" });
    return;
  }
  if (p.type === "flight_change") {
    await swapFlight(p.itemId, p.newFlightId, p.oldFlightId, p.pnr, p.leg);
    return;
  }
  const nf = await swapFlight(p.flightItemId, p.newFlightId, p.oldFlightId, p.pnr, "return");
  void nf;
  const [hi] = await tx.select().from(s.bookingItems).where(eq(s.bookingItems.id, p.hotelItemId));
  const hd = hi.details as Record<string, unknown>;
  await tx.update(s.bookingItems).set({ details: { ...hd, checkoutDate: p.newEnd, nights: Number(hd.nights) + p.extraNights }, priceInr: hi.priceInr + p.hotelCost, updatedAt: new Date() }).where(eq(s.bookingItems.id, p.hotelItemId));
  if (p.dropItemId) await tx.update(s.bookingItems).set({ date: p.newEnd, updatedAt: new Date() }).where(eq(s.bookingItems.id, p.dropItemId));
  await tx
    .update(s.roomInventory)
    .set({ roomsLeft: sql`${s.roomInventory.roomsLeft} - ${p.roomsNeeded}` })
    .where(and(eq(s.roomInventory.hotelId, p.hotelId), eq(s.roomInventory.roomType, "standard"), gte(s.roomInventory.date, p.checkoutDate), lt(s.roomInventory.date, p.newEnd)));
}
