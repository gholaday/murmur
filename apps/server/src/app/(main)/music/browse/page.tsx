import { getContext } from "@/server/context";
import { listAlbums, musicSummary } from "@/server/music/queries";
import { requirePageUser } from "@/server/session";
import { BrowseView } from "@/web/music/browse-view";

export default async function BrowsePage() {
  const user = await requirePageUser();
  const ctx = await getContext();
  return <BrowseView summary={musicSummary(ctx, user.id)} albums={await listAlbums(ctx, user.id, "all", "added")} />;
}
