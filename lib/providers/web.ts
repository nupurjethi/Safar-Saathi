export type WebResult = { title: string; url: string; snippet: string };

/**
 * General travel information (visa rules, attractions, etiquette) from a search API: Brave or Tavily, with the
 * user's own key. Results are information with sources. They can NEVER be used as a booking price.
 */
export async function searchWeb(query: string): Promise<{ configured: boolean; provider?: string; results: WebResult[]; note: string }> {
  const note = "Information only, from the sources listed. Not a booking price. Check official sources before you rely on it.";
  const q = query.slice(0, 200);
  if (process.env.TAVILY_API_KEY) {
    const r = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TAVILY_API_KEY}` }, body: JSON.stringify({ query: q, max_results: 4 }), signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Tavily ${r.status}`);
    const j = (await r.json()) as { results?: { title: string; url: string; content: string }[] };
    return { configured: true, provider: "tavily", results: (j.results ?? []).map((x) => ({ title: x.title, url: x.url, snippet: x.content.slice(0, 280) })), note };
  }
  if (process.env.BRAVE_API_KEY) {
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=4`, { headers: { "X-Subscription-Token": process.env.BRAVE_API_KEY, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Brave ${r.status}`);
    const j = (await r.json()) as { web?: { results?: { title: string; url: string; description: string }[] } };
    return { configured: true, provider: "brave", results: (j.web?.results ?? []).map((x) => ({ title: x.title, url: x.url, snippet: x.description.replace(/<[^>]+>/g, "").slice(0, 280) })), note };
  }
  return { configured: false, results: [], note: "Web search is not configured (set TAVILY_API_KEY or BRAVE_API_KEY). I cannot look this up." };
}
