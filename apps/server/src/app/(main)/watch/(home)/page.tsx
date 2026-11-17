import { getContext } from "@/server/context";
import { hiddenFor, visibleWatchHome, withoutIds } from "@/server/hidden";
import { requirePageUser } from "@/server/session";
import { listMovies, listShows, watchHome } from "@/server/watch/queries";
import { WatchView } from "@/web/watch/watch-view";

/** Movies and shows: Continue watching, Next episodes and Recently added, then the whole collection. */
export default async function WatchPage() {
  const user = await requirePageUser();
  const ctx = await getContext();
  const hidden = hiddenFor(ctx, user.id);
  const [home, movies, shows] = await Promise.all([watchHome(ctx, user.id), listMovies(ctx, user.id), listShows(ctx, user.id)]);
  return <WatchView home={visibleWatchHome(home, hidden)} movies={withoutIds(movies, hidden.movies)} shows={withoutIds(shows, hidden.shows)} />;
}
