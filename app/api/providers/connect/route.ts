import { z } from "zod";
import { handle, json, readJson } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { connectedPlatforms, setConnected } from "@/lib/server/connections";
import { PLATFORM_IDS } from "@/lib/providers/platforms";
import { GateError } from "@/lib/gate/errors";

export const dynamic = "force-dynamic";
export const GET = handle(async () => {
  const sess = await requireSession();
  return json({ connected: await connectedPlatforms(sess.uid) });
});
/** "I am logged in to <platform>" (or not). Self-declared, so nothing is checked and no credential is ever sent here. */
export const POST = handle(async (req: Request) => {
  const sess = await requireSession();
  const b = await readJson(req, z.object({ provider: z.enum(PLATFORM_IDS as [string, ...string[]]), connected: z.boolean() }));
  try { return json({ connected: await setConnected(sess.uid, b.provider, b.connected) }); } catch { throw new GateError("BAD_REQUEST", 400, "Unknown platform."); }
});
