import { listCases } from "@/lib/server/cases";
import { handle, json } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const GET = handle(async () => {
  await requireSession(["admin", "agent"]);
  return json({ cases: await listCases(), now: new Date().toISOString() });
});
