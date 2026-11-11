import { and, asc, desc, eq } from "drizzle-orm";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { runAgent, type AgentEvent } from "@/lib/agent/run";
import type { UiEvent } from "@/lib/agent/tools";
import { bookingForSession } from "@/lib/server/access";
import { GateError } from "@/lib/gate/errors";
import { handle, readJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  bookingRef: z.string().regex(/^SS-\d{5}$/),
  message: z.string().min(1).max(800),
  threadId: z.string().uuid().optional().nullable(),
  chaos: z.literal("price_move").optional(),
});

/** Streams NDJSON events: thread, step chips, text deltas, review cards, cases, routes, done. */
export const POST = handle(async (req: Request) => {
  const sess = await requireSession();
  rateLimit(`agent:${sess.uid}`, 20, 60_000);
  const body = await readJson(req, Body);
  const booking = await bookingForSession(body.bookingRef, sess);
  if (booking.userId !== sess.uid) throw new GateError("FORBIDDEN", 403, "That booking belongs to someone else.");
  const db = await getDb();

  let threadId = body.threadId ?? null;
  if (threadId) {
    const [t] = await db.select().from(s.agentThreads).where(and(eq(s.agentThreads.id, threadId), eq(s.agentThreads.userId, sess.uid)));
    if (!t) threadId = null;
  }
  if (!threadId) {
    const [t] = await db.select().from(s.agentThreads).where(and(eq(s.agentThreads.userId, sess.uid), eq(s.agentThreads.bookingId, booking.id), eq(s.agentThreads.channel, "app"))).orderBy(desc(s.agentThreads.createdAt)).limit(1);
    threadId = t?.id ?? (await db.insert(s.agentThreads).values({ userId: sess.uid, bookingId: booking.id, channel: "app" }).returning())[0].id;
  }
  const prev = await db.select().from(s.agentMessages).where(eq(s.agentMessages.threadId, threadId)).orderBy(asc(s.agentMessages.createdAt));
  const history: ModelMessage[] = prev.slice(-12).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  await db.insert(s.agentMessages).values({ threadId, role: "user", content: body.message });

  const enc = new TextEncoder();
  const t0 = Date.now();
  const parts: unknown[] = [];
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (e: Record<string, unknown>) => {
        if (!open) return;
        try { controller.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch { open = false; } // client went away
      };
      send({ t: "thread", id: threadId });
      try {
        const ui: UiEvent[] = [];
        const res = await runAgent({
          ctx: { userId: sess.uid, bookingRef: booking.ref, bookingId: booking.id, threadId, channel: "app", now: new Date(), chaos: process.env.DEMO_MODE !== "false" ? body.chaos : undefined, ui: (e) => ui.push(e) },
          history,
          message: body.message,
          emit: (e: AgentEvent) => {
            if (e.t !== "step" && e.t !== "text") parts.push(e);
            send(e);
          },
        });
        const ms = Date.now() - t0;
        await db.insert(s.agentMessages).values({ threadId, role: "assistant", content: res.text, parts });
        await db.insert(s.events).values({ name: "agent_answer_time", userId: sess.uid, bookingId: booking.id, props: { ms, agent: res.agent } });
        send({ t: "done", ms, agent: res.agent, label: res.label });
      } catch (e) {
        console.error("[agent]", e);
        send({ t: "error", message: "The assistant had a problem. Your trip data is safe. Try again, or tap SOS if it is urgent." });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
});

/** Chat history for the traveller's thread, with the current status of each review card's quote. */
export const GET = handle(async (req: Request) => {
  const sess = await requireSession();
  const ref = new URL(req.url).searchParams.get("bookingRef") ?? "";
  const booking = await bookingForSession(ref, sess);
  if (booking.userId !== sess.uid) throw new GateError("FORBIDDEN", 403, "That booking belongs to someone else.");
  const db = await getDb();
  const [t] = await db.select().from(s.agentThreads).where(and(eq(s.agentThreads.userId, sess.uid), eq(s.agentThreads.bookingId, booking.id), eq(s.agentThreads.channel, "app"))).orderBy(desc(s.agentThreads.createdAt)).limit(1);
  if (!t) return Response.json({ threadId: null, messages: [] });
  const msgs = await db.select().from(s.agentMessages).where(eq(s.agentMessages.threadId, t.id)).orderBy(asc(s.agentMessages.createdAt)).limit(60);
  const quotes = await db.select({ id: s.changeQuotes.id, status: s.changeQuotes.status, expiresAt: s.changeQuotes.expiresAt }).from(s.changeQuotes).where(eq(s.changeQuotes.bookingId, booking.id));
  const qs = new Map(quotes.map((q) => [q.id, q.expiresAt.getTime() < Date.now() && q.status === "open" ? "expired" : q.status]));
  return Response.json({
    threadId: t.id,
    messages: msgs.map((m) => ({
      id: m.id, role: m.role, text: m.content,
      parts: ((m.parts ?? []) as { t: string; card?: { quoteId: string } }[]).map((p) => (p.t === "review" && p.card ? { ...p, quoteStatus: qs.get(p.card.quoteId) ?? "void" } : p)),
    })),
  });
});
