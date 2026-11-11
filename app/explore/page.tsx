import { ExploreView } from "@/components/explore/ExploreView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Explore trips" };
export default function ExplorePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <ExploreView searchParams={searchParams} />;
}
