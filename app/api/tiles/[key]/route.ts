import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";

export const dynamic = "force-dynamic";
// Offline street-map files generated for uploaded plans (OpenStreetMap data, public). Served with HTTP Range support so the map
// can read them online, and downloaded whole into the phone's trip cache by the offline sync.
const cache = new Map<string, Buffer>();

export async function GET(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key: raw } = await ctx.params;
  const key = raw.replace(/\.pmtiles$/, "");
  if (!/^[a-z0-9-]{3,80}$/.test(key)) return new Response("Not found", { status: 404 });
  let data = cache.get(key);
  if (!data) {
    const db = await getDb();
    const [row] = await db.select({ data: s.mapTiles.data }).from(s.mapTiles).where(eq(s.mapTiles.key, key)).limit(1);
    if (!row) return new Response("Not found", { status: 404 });
    data = Buffer.from(row.data);
    if (cache.size > 20) cache.delete(cache.keys().next().value!);
    cache.set(key, data);
  }
  const headers = { "Content-Type": "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400" };
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.get("range") ?? "");
  if (!m) return new Response(new Uint8Array(data), { headers: { ...headers, "Content-Length": String(data.length) } });
  const start = Number(m[1]), end = m[2] ? Math.min(Number(m[2]), data.length - 1) : data.length - 1;
  if (start >= data.length) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${data.length}` } });
  return new Response(new Uint8Array(data.subarray(start, end + 1)), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${data.length}`, "Content-Length": String(end - start + 1) } });
}
