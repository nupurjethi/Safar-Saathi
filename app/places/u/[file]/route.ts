import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";

export const dynamic = "force-dynamic";
/** Photos found for places in uploaded plans (stored in the database); the offline sync saves them with the trip. */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const key = (await ctx.params).file.replace(/\.(jpg|png)$/, "");
  if (!/^[a-z0-9-]{3,80}$/.test(key)) return new Response("Not found", { status: 404 });
  const [row] = await (await getDb()).select().from(s.placePhotos).where(eq(s.placePhotos.key, key)).limit(1);
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(row.data), { headers: { "Content-Type": row.mime, "Content-Length": String(row.bytes), "Cache-Control": "public, max-age=604800, immutable" } });
}
