import { notFound } from "next/navigation";
import { EPISODE_PAGE } from "@murmur/shared";
import { getContext } from "@/server/context";
import { getPodcast, listEpisodes, shortNotes } from "@/server/podcasts/queries";
import { requirePageUser } from "@/server/session";
import { ShowView } from "@/web/podcasts/show-view";

export default async function ShowPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { sqlite } = await getContext();
  const id = (await params).id;
  const podcast = await getPodcast(sqlite, id, user.id);
  if (!podcast) notFound();
  // Only the first page goes with the page; long shows have over a thousand episodes, and
  // the rest load from the API when you ask for more or change the order.
  return <ShowView podcast={podcast} pageSize={EPISODE_PAGE} firstPage={shortNotes(listEpisodes(sqlite, id, user.id, EPISODE_PAGE))} />;
}
