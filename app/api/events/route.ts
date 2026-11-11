import { z } from "zod";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { handle, json, readJson } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";
import { rateLimit } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";
const NAMES = ["pack_ready", "offline_answer", "sos_tap", "install_prompt", "agent_answer_time", "change_completed"] as const;
/** Client-measured success metrics (offline answer latency, pack-ready time, ...). */
export const POST = handle(async (req: Request) => {
  const sess = await getSession();
  rateLimit(`ev:${sess?.uid ?? "anon"}`, 60, 60_000);
  const b = await readJson(req, z.object({ name: z.enum(NAMES), props: z.record(z.string(), z.union([z.string().max(100), z.number(), z.boolean()])).optional() }));
  const db = await getDb();
  await db.insert(s.events).values({ name: b.name, userId: sess?.uid ?? null, props: b.props ?? {} });
  return json({ ok: true });
});
