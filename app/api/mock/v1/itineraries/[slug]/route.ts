import { handle, json } from "@/lib/server/http";
import { GateError } from "@/lib/gate/errors";
import { itineraryDetail } from "@/lib/server/catalogue";

export const dynamic = "force-dynamic";
export const GET = handle(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const u = new URL(req.url);
  const start = u.searchParams.get("start") ?? undefined;
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new GateError("BAD_REQUEST", 400, "start must be YYYY-MM-DD");
  const pax = Math.min(Math.max(Number(u.searchParams.get("pax") ?? 2) || 2, 1), 9);
  const d = await itineraryDetail(slug, start, pax);
  if (!d) throw new GateError("NOT_FOUND", 404, "Itinerary not found.");
  return json({ ...d, notice: "Sample data. Not live inventory." });
});
