import { z } from "zod";
import { handle, json } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";
const Q = z.object({ lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180) });

/** Live weather (online only). Proxied server-side so the app only ever talks to its own origin. */
export const GET = handle(async (req: Request) => {
  rateLimit("weather", 120, 60_000);
  const q = Q.parse(Object.fromEntries(new URL(req.url).searchParams));
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${q.lat.toFixed(2)}&longitude=${q.lon.toFixed(2)}&current=temperature_2m,weather_code&timezone=auto`, { next: { revalidate: 1800 }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) return json({ error: "UPSTREAM", message: "Weather is not available right now." }, 502);
  const j = (await res.json()) as { current?: { temperature_2m: number; weather_code: number } };
  const code = j.current?.weather_code ?? -1;
  const text = code === 0 ? "Clear" : code <= 3 ? "Partly cloudy" : code <= 48 ? "Foggy" : code <= 67 ? "Rain" : code <= 77 ? "Snow" : code <= 99 ? "Showers or storms" : "Unknown";
  return json({ tempC: j.current?.temperature_2m ?? null, summary: text });
});
