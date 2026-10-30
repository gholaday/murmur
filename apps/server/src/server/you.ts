import type { UserDto } from "@murmur/shared";
import type { ProfileView } from "@/web/profile/profile-view";
import { adsEnabled } from "./ads";
import type { AppContext } from "./context";
import { env } from "./env";
import { folderList } from "./library/folders";
import { libraryAdmin } from "./library-admin";
import { musicSummary } from "./music/queries";
import { cacheStatus } from "./podcasts/cache-status";
import { getPrefs } from "./prefs";
import { updateStatus } from "./updates";
import { watchSummary } from "./watch/queries";
import { videoHealth, videoStatus } from "./watch/video-addon";

/** Everything the You page and its settings pages show; admin-only parts are empty for others. */
export async function youProps(ctx: AppContext, user: UserDto): Promise<Omit<React.ComponentProps<typeof ProfileView>, "section">> {
  const users: UserDto[] = user.isAdmin
    ? (ctx.sqlite.prepare("SELECT id, username, is_admin FROM users ORDER BY username").all() as Array<{
        id: number;
        username: string;
        is_admin: number;
      }>).map((u) => ({ id: u.id, username: u.username, isAdmin: u.is_admin === 1 }))
    : [];
  const bookCount = (ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM books WHERE missing_since IS NULL").get() as { n: number }).n;
  const shows = (ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?").get(user.id) as { n: number }).n;
  const prefs = getPrefs(ctx, user.id);
  const movieFolders = user.isAdmin ? await folderList(ctx.db, ctx.sqlite, "movies") : [];
  const showFolders = user.isAdmin ? await folderList(ctx.db, ctx.sqlite, "shows") : [];
  return {
    music: musicSummary(ctx, user.id),
    musicFolders: user.isAdmin ? await folderList(ctx.db, ctx.sqlite, "music") : [],
    movieFolders,
    showFolders,
    // Only asked once there's something to watch, so a server without videos never waits on the add-on.
    video: movieFolders.length + showFolders.length > 0 ? videoStatus(await videoHealth()) : null,
    watch: watchSummary(ctx),
    shows,
    tabs: prefs.tabs,
    videoQuality: prefs.videoQuality,
    autoplayNext: prefs.autoplayNext,
    user,
    users,
    folders: user.isAdmin ? await folderList(ctx.db, ctx.sqlite) : [],
    adsEnabled: adsEnabled(),
    cache: user.isAdmin ? cacheStatus(ctx) : null,
    libraryAdmin: user.isAdmin ? await libraryAdmin(ctx, user.id) : null,
    server: {
      version: env.version,
      devBuild: env.devBuild,
      updates: user.isAdmin ? updateStatus() : null,
      books: bookCount,
      watcher: ctx.watcher.mode(),
    },
  };
}
