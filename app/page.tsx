import { ExploreView } from "@/components/explore/ExploreView";

export const dynamic = "force-dynamic";
// Revision v2: the catalogue is the home page. The scroll story lives at /story.
export default function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <ExploreView searchParams={searchParams} home />;
}
