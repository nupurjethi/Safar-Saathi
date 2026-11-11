import { z } from "zod";
import { handle, json, readJson } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { createQuote } from "@/lib/gate/changes";
import { rateLimit } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";
const Body = z.object({
  bookingRef: z.string().regex(/^SS-\d{5}$/),
  kind: z.enum(["flight_change", "hotel_extend"]),
  params: z.object({ itemId: z.string().uuid().optional(), newFlightId: z.string().uuid().optional(), extraNights: z.number().int().min(1).max(3).optional() }),
});

export const POST = handle(async (req: Request) => {
  const sess = await requireSession();
  rateLimit(`quote:${sess.uid}`, 20, 60_000);
  const body = await readJson(req, Body);
  // ?chaos=price_move: demo only. Moves the price 5–15% between quote and apply so re-quoting can be shown.
  const chaos = process.env.DEMO_MODE !== "false" && new URL(req.url).searchParams.get("chaos") === "price_move" ? "price_move" : null;
  const card = await createQuote({ bookingRef: body.bookingRef, userId: sess.uid, kind: body.kind, params: body.params, chaos });
  return json(card);
});
