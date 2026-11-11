import { getLatestPack } from "@/lib/packs/build";
import { bookingForSession } from "@/lib/server/access";
import { handle, json } from "@/lib/server/http";
import { GateError } from "@/lib/gate/errors";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ bookingId: string }> }) => {
  const sess = await requireSession();
  const { bookingId } = await ctx.params;
  const b = await bookingForSession(bookingId, sess);
  const row = await getLatestPack(b.id);
  if (!row) throw new GateError("NOT_FOUND", 404, "No pack built yet.");
  return json(row.pack, { headers: { "Cache-Control": "private, no-store", ETag: `"${row.contentHash}"` } });
});
