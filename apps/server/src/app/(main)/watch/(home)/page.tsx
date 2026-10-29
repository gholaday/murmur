import { redirect } from "next/navigation";
import { getContext } from "@/server/context";
import { requirePageUser } from "@/server/session";
import { listMovies, listShows, watchEnabled, watchHome } from "@/server/watch/queries";
import { WatchView } from "@/web/watch/watch-view";

/** Movies and shows: Continue watching, Next episodes and Recently added, then the whole collection. */
export default async function WatchPage() {
  const user = await requirePageUser();
  const ctx = await getContext();
  // Off, or the video add-on went down while this was open: back to Books rather than a 404.
  if (!watchEnabled(ctx)) redirect("/");
  const [home, movies, shows] = await Promise.all([watchHome(ctx, user.id), listMovies(ctx, user.id), listShows(ctx, user.id)]);
  return <WatchView home={home} movies={movies} shows={shows} isAdmin={user.isAdmin} />;
}
