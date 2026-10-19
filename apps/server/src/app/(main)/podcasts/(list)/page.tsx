import { getContext } from "@/server/context";
import { listContinueEpisodes, listNewEpisodes, listPodcasts } from "@/server/podcasts/queries";
import { requirePageUser } from "@/server/session";
import { PodcastsView } from "@/web/podcasts/podcasts-view";

export default async function PodcastsPage() {
  const user = await requirePageUser();
  const { sqlite } = await getContext();
  const [podcasts, continueEpisodes, newEpisodes] = await Promise.all([
    listPodcasts(sqlite, user.id),
    listContinueEpisodes(sqlite, user.id, 20),
    listNewEpisodes(sqlite, user.id, 50),
  ]);
  return <PodcastsView podcasts={podcasts} continueEpisodes={continueEpisodes} newEpisodes={newEpisodes} />;
}
