import { Story } from "@/components/story/Story";
import { loadFeatured } from "@/lib/server/featured";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "How it works" };

export default async function StoryPage() {
  const sess = await getSession().catch(() => null);
  return <Story featured={await loadFeatured()} viewer={sess ? { name: sess.name, role: sess.role } : null} />;
}
