import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { GateError } from "@/lib/gate/errors";
import { handle, json } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { requireSession } from "@/lib/server/session";
import { MAX_FILE_BYTES, MAX_FILES, parseFile } from "@/lib/plans/parse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Add ONE file to a plan (multipart field "file"). It is read right away; only its text or image is kept, until processing. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const sess = await requireSession(["traveller"]);
  rateLimit(`planfile:${sess.uid}`, 60, 10 * 60_000);
  const { id } = await ctx.params;
  const db = await getDb();
  const [plan] = await db.select().from(s.travelPlans).where(and(eq(s.travelPlans.id, id), eq(s.travelPlans.userId, sess.uid))).limit(1);
  if (!plan) throw new GateError("NOT_FOUND", 404, "Plan not found.");
  if (plan.status === "ready") throw new GateError("BAD_REQUEST", 409, "This plan is already built. Start a new one to add files.");
  const [{ n }] = await db.select({ n: count() }).from(s.planFiles).where(eq(s.planFiles.planId, id));
  if (Number(n) >= MAX_FILES) throw new GateError("BAD_REQUEST", 400, `Up to ${MAX_FILES} files per plan.`);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw new GateError("BAD_REQUEST", 400, "No file received.");
  if (file.size > MAX_FILE_BYTES) throw new GateError("BAD_REQUEST", 413, `${file.name} is larger than ${MAX_FILE_BYTES / 1048576} MB. Split it or take a screenshot.`);
  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = await parseFile(file.name, file.type || "application/octet-stream", buf);
  const status = parsed.text || parsed.imageDataUrl ? "parsed" : "skipped";
  const [row] = await db.insert(s.planFiles).values({ planId: id, name: file.name.slice(0, 200), mime: (file.type || "application/octet-stream").slice(0, 120), kind: parsed.kind, bytes: file.size, sha256: parsed.sha256, status, note: parsed.note ?? null, text: parsed.text ?? null, imageDataUrl: parsed.imageDataUrl ?? null }).returning({ id: s.planFiles.id });
  return json({ file: { id: row.id, name: file.name, kind: parsed.kind, status, note: parsed.note ?? null, chars: parsed.text?.length ?? 0 } }, 201);
});
