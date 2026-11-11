import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { GateError } from "@/lib/gate/errors";

export const json = (data: unknown, init?: number | ResponseInit) =>
  NextResponse.json(data, typeof init === "number" ? { status: init } : init);

/** Wrap a route handler: GateError -> typed JSON error, ZodError -> 400, anything else -> 500 (logged). */
export function handle<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    try {
      return await fn(...a);
    } catch (e) {
      if (e instanceof GateError) return json(e.toJSON(), e.status);
      if (e instanceof ZodError) return json({ error: "BAD_REQUEST", message: "Invalid input.", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
      console.error("[api]", e);
      return json({ error: "INTERNAL", message: "Something went wrong on our side." }, 500);
    }
  };
}

export async function readJson<T>(req: Request, schema: { parse: (v: unknown) => T }, maxBytes = 20_000): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new GateError("BAD_REQUEST", 413, "Request too large.");
  let raw: unknown = {};
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new GateError("BAD_REQUEST", 400, "Body must be JSON.");
  }
  return schema.parse(raw);
}
