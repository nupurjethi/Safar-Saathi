import { z } from "zod";
import { handle, json, readJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { requireSession } from "@/lib/server/session";
import { payTrip, selectTrip } from "@/lib/server/trips";

export const dynamic = "force-dynamic";
const Trav = z.object({ name: z.string().min(1).max(80), ageBand: z.enum(["child", "teen", "adult", "senior"]), passportLast4: z.string().regex(/^\d{4}$/).optional() });
const Body = z.union([
  z.object({ ref: z.string().regex(/^SS-\d{5}$/), travellers: z.array(Trav).min(1).max(9), payment: z.object({ method: z.literal("dummy") }) }),
  z.object({ slug: z.string().max(96), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), travellers: z.array(Trav).min(1).max(9), payment: z.object({ method: z.literal("dummy") }) }),
]);

/** Book a trip: pay for a selected draft (`ref`), or select and pay in one call (`slug` + `startDate`). */
export const POST = handle(async (req: Request) => {
  const sess = await requireSession();
  rateLimit(`book:${sess.uid}`, 6, 60_000);
  const body = await readJson(req, Body);
  let ref: string;
  if ("ref" in body) ref = body.ref;
  else ref = (await selectTrip({ userId: sess.uid, slug: body.slug, startDate: body.startDate, pax: body.travellers.length })).ref;
  const r = await payTrip({ userId: sess.uid, ref, travellers: body.travellers });
  return json({ ...r, notice: "Test payment, no money moved. Sample data." }, 201);
});
