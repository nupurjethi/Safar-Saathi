import { getLatestPack, publishPack } from "@/lib/packs/build";
import { bookingForSession } from "@/lib/server/access";
import { handle, json } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ bookingId: string }> }) => {
  const sess = await requireSession();
  const { bookingId } = await ctx.params;
  const b = await bookingForSession(bookingId, sess);
  const row = (await getLatestPack(b.id)) ?? null;
  if (!row) return json((await publishPack(b.id)).manifest, { headers: { "Cache-Control": "no-store" } });
  return json(row.manifest, { headers: { "Cache-Control": "no-store" } });
});
