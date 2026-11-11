import type { Featured } from "@/components/story/Story";
import { searchItineraries } from "@/lib/server/catalogue";
import { inr } from "@/lib/time";
import { creditLine } from "@/components/ui/PlacePhoto";

// A fixed, honest shortlist: Neha's demo trip plus one standard-tier trip from five other destinations (all sample data).
const PICK = ["paris-rome-classic-7n", "dubai", "bali", "tokyo", "singapore", "maldives"];

export async function loadFeatured(): Promise<Featured[]> {
  try {
    const all = (await searchItineraries({ pageSize: 60, sort: "rating" })).items;
    const out: Featured[] = [];
    for (const key of PICK) {
      const it = all.find((i) => i.slug === key) ?? all.find((i) => i.cities[0] === key && i.cities.length === 1 && i.tier === "standard") ?? all.find((i) => i.cities[0] === key);
      if (!it) continue;
      out.push({
        slug: it.slug, title: it.title, sub: `${it.theme} · ${it.nights} nights · ${it.tier}`, price: `${inr(it.pricePerPersonInr)} per person`,
        palette: it.heroPalette as [string, string], cities: it.cityNames, blurb: it.summary,
        image: it.hero ? { src: it.hero.src, credit: creditLine(it.hero.credit), sourceUrl: it.hero.credit.sourceUrl, title: it.hero.credit.title } : undefined,
      });
    }
    if (out.length) return out;
  } catch {
    /* no database yet: fall through to the static shortlist */
  }
  return [
    { slug: "paris-rome-classic-7n", title: "Paris & Rome Classic", sub: "culture · 7 nights", price: "Sample price", palette: ["#818CF8", "#1E1B4B"], cities: ["Paris", "Rome"], image: { src: "/places/paris/eiffel-tower.jpg", credit: "Photo: Benh LIEU SONG · Public domain", sourceUrl: "https://commons.wikimedia.org/", title: "Eiffel Tower" }, blurb: "Seven nights across Paris and Rome with airport transfers and a culture-style day plan. Sample itinerary." },
    { slug: "dubai-5n-standard-family", title: "Dubai: Family Fun Getaway", sub: "family · 5 nights", price: "Sample price", palette: ["#F59E0B", "#7C2D12"], cities: ["Dubai"], blurb: "Skyline, desert and beach days for the whole family. Sample itinerary." },
    { slug: "bali-5n-standard-beach", title: "Bali: Island Time", sub: "beach · 5 nights", price: "Sample price", palette: ["#10B981", "#064E3B"], cities: ["Bali"], blurb: "Temples, rice terraces and slow beach mornings. Sample itinerary." },
  ];
}

