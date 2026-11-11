import { z } from "zod";
import { handle, json, readJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { requireSession } from "@/lib/server/session";
import { payTrip } from "@/lib/server/trips";

export const dynamic = "force-dynamic";
export const POST = handle(async (req: Request, ctx: { params: Promise<{ ref: string }> }) => {
  const sess = await requireSession();
  rateLimit(`pay:${sess.uid}`, 6, 60_000);
  const { ref } = await ctx.params;
  const b = await readJson(req, z.object({
    travellers: z.array(z.object({ name: z.string().min(1).max(80), ageBand: z.enum(["child", "teen", "adult", "senior"]), passportLast4: z.string().regex(/^\d{4}$/).optional() })).min(1).max(9),
    payment: z.object({ method: z.literal("dummy") }),
  }));
  return json({ ...(await payTrip({ userId: sess.uid, ref, travellers: b.travellers })), notice: "Test payment, no money moved. Sample data." });
});
