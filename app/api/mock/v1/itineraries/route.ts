import { z } from "zod";
import { handle, json } from "@/lib/server/http";
import { searchItineraries } from "@/lib/server/catalogue";

export const dynamic = "force-dynamic";
const Q = z.object({
  q: z.string().max(60).optional(), dest: z.string().max(60).optional(), tier: z.enum(["budget", "standard", "premium"]).optional(),
  nights: z.coerce.number().int().min(1).max(30).optional(), budget: z.coerce.number().int().min(0).optional(),
  theme: z.enum(["beach", "culture", "adventure", "family", "honeymoon"]).optional(), from: z.string().length(3).optional(),
  sort: z.enum(["price_asc", "price_desc", "rating"]).optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(60).optional(),
});

export const GET = handle(async (req: Request) => {
  const q = Q.parse(Object.fromEntries(new URL(req.url).searchParams));
  return json({ ...(await searchItineraries(q)), notice: "Sample data. Not live inventory." });
});
