import { requireSession } from "@/lib/server/session";
import { handle } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { processPlan } from "@/lib/plans/process";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Build the trip and its offline bundle from the uploaded files. Streams progress steps as NDJSON, then the result. */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const sess = await requireSession(["traveller"]);
  rateLimit(`planproc:${sess.uid}`, 10, 60 * 60_000);
  const { id } = await ctx.params;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: Record<string, unknown>) => { try { controller.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch { /* client left */ } };
      try {
        const r = await processPlan(id, sess.uid, (label) => send({ t: "step", label }));
        send(r.ok ? { t: "done", ref: r.ref, warnings: r.warnings } : { t: "error", message: r.error });
      } catch (e) {
        console.error("[plan]", e);
        send({ t: "error", message: "Something went wrong while building your plan. Your files are safe; try again." });
      } finally {
        try { controller.close(); } catch { /* closed */ }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform" } });
});
