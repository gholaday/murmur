import { notFound } from "next/navigation";
import { EPISODE_PAGE, SHOW_TABS } from "@murmur/shared";
import { listBookmarks } from "@/server/bookmarks";
import { getContext } from "@/server/context";
import { getPodcast, listEpisodes, shortNotes } from "@/server/podcasts/queries";
import { requirePageUser } from "@/server/session";
import { ShowView } from "@/web/podcasts/show-view";

export default async function ShowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePageUser();
  const ctx = await getContext();
  const { sqlite } = ctx;
  const id = (await params).id;
  // ?tab= opens a tab, as Browse's More like heading does.
  const wanted = (await searchParams).tab;
  const tab = SHOW_TABS.find((t) => t.id === wanted)?.id ?? "episodes";
  const podcast = await getPodcast(sqlite, id, user.id);
  if (!podcast) notFound();
  const bookmarks = listBookmarks(ctx, user.id).filter((b) => b.podcastId === id);
  // Only the first page goes with the page; long shows have over a thousand episodes, and
  // the rest load from the API when you ask for more or change the order.
  return <ShowView podcast={podcast} bookmarks={bookmarks} initialTab={tab} pageSize={EPISODE_PAGE} firstPage={shortNotes(listEpisodes(sqlite, id, user.id, EPISODE_PAGE))} />;
}
