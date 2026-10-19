import { getContext } from "@/server/context";
import { listNewEpisodes, listPodcasts } from "@/server/podcasts/queries";
import { requirePageUser } from "@/server/session";
import { PodcastsView } from "@/web/podcasts/podcasts-view";

export default async function PodcastsPage() {
  const user = await requirePageUser();
  const { sqlite } = await getContext();
  const [podcasts, newEpisodes] = await Promise.all([listPodcasts(sqlite, user.id), listNewEpisodes(sqlite, user.id, 30)]);
  return <PodcastsView podcasts={podcasts} newEpisodes={newEpisodes} />;
}
