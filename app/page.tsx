import { redirect } from "next/navigation";
import { ExploreView } from "@/components/explore/ExploreView";
import { Story } from "@/components/story/Story";
import { loadFeatured } from "@/lib/server/featured";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * "/" is the landing page.
 *  - Not signed in: the "How it works" story, with Travel user login and Agent login.
 *  - Travel user signed in: Home (the trip catalogue) with a short "How Safar Saathi works" guide.
 *  - Agent signed in: straight to the agent desk.
 * The full story is always available at /story.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sess = await getSession().catch(() => null);
  if (!sess) return <Story featured={await loadFeatured()} viewer={null} />;
  if (sess.role === "agent" || sess.role === "admin") redirect("/agent");
  return <ExploreView searchParams={searchParams} home />;
}
