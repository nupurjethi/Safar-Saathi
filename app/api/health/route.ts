import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";
// Tiny and cache-less: the client heartbeat uses this to tell "online" from "no data".
export async function GET() {
  return json({ ok: true, ts: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
export const HEAD = GET;
