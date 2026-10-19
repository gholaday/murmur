import { notFound } from "next/navigation";
import { getContext } from "@/server/context";
import { getPodcast, listEpisodes } from "@/server/podcasts/queries";
import { requirePageUser } from "@/server/session";
import { ShowView } from "@/web/podcasts/show-view";

export default async function ShowPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { sqlite } = await getContext();
  const id = (await params).id;
  const podcast = await getPodcast(sqlite, id, user.id);
  if (!podcast) notFound();
  return <ShowView podcast={podcast} episodes={listEpisodes(sqlite, id, user.id)} isAdmin={user.isAdmin} />;
}
