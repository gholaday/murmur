import type { UserDto } from "@murmur/shared";
import type { ProfileView } from "@/web/profile/profile-view";
import { adsEnabled } from "./ads";
import type { AppContext } from "./context";
import { env } from "./env";
import { folderList } from "./library/folders";
import { musicSummary } from "./music/queries";
import { cacheStatus } from "./podcasts/cache-status";
import { getPrefs } from "./prefs";
import { updateStatus } from "./updates";
import { watchSummary } from "./watch/queries";

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
  return {
    music: musicSummary(ctx, user.id),
    musicFolders: user.isAdmin ? await folderList(ctx.db, ctx.sqlite, "music") : [],
    movieFolders: user.isAdmin ? await folderList(ctx.db, ctx.sqlite, "movies") : [],
    showFolders: user.isAdmin ? await folderList(ctx.db, ctx.sqlite, "shows") : [],
    watch: watchSummary(ctx),
    shows,
    tabs: getPrefs(ctx, user.id).tabs,
    videoQuality: getPrefs(ctx, user.id).videoQuality,
    user,
    users,
    folders: user.isAdmin ? await folderList(ctx.db, ctx.sqlite) : [],
    adsEnabled: adsEnabled(),
    cache: user.isAdmin ? cacheStatus(ctx) : null,
    server: {
      version: env.version,
      devBuild: env.devBuild,
      updates: user.isAdmin ? updateStatus() : null,
      books: bookCount,
      scanRunning: ctx.scanState.running,
      lastScanAt: ctx.scanState.lastFinishedAt,
      lastScanError: ctx.scanState.lastError,
      watcher: ctx.watcher.mode(),
    },
  };
}
