import { PODCAST_GENRES } from "@murmur/shared";
import { requirePageUser } from "@/server/session";
import { TopShowsView } from "@/web/podcasts/browse";

/** Top shows from Browse: /podcasts/top, or ?genre=<Apple category id> for one category. */
export default async function TopShowsPage({ searchParams }: { searchParams: Promise<{ genre?: string }> }) {
  await requirePageUser();
  const genre = Number((await searchParams).genre);
  return <TopShowsView initialGenre={PODCAST_GENRES.some((g) => g.id === genre) ? genre : null} />;
}
