import type { UserDto } from "@murmur/shared";
import { getContext } from "@/server/context";
import { env } from "@/server/env";
import { adsEnabled } from "@/server/ads";
import { folderList } from "@/server/library/folders";
import { cacheStatus } from "@/server/podcasts/cache-status";
import { musicSummary } from "@/server/music/queries";
import { getPrefs } from "@/server/prefs";
import { requirePageUser } from "@/server/session";
import { updateStatus } from "@/server/updates";
import { ProfileView } from "@/web/profile/profile-view";

export default async function ProfilePage() {
  const user = await requirePageUser();
  const ctx = await getContext();
  const users: UserDto[] = user.isAdmin
    ? (ctx.sqlite.prepare("SELECT id, username, is_admin FROM users ORDER BY username").all() as Array<{
        id: number;
        username: string;
        is_admin: number;
      }>).map((u) => ({ id: u.id, username: u.username, isAdmin: u.is_admin === 1 }))
    : [];
  const bookCount = (ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM books WHERE missing_since IS NULL").get() as { n: number }).n;
  const shows = (ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?").get(user.id) as { n: number }).n;
  const folders = user.isAdmin ? await folderList(ctx.db, ctx.sqlite) : [];
  const musicFolders = user.isAdmin ? await folderList(ctx.db, ctx.sqlite, "music") : [];
  return (
    <ProfileView
      music={musicSummary(ctx)}
      musicFolders={musicFolders}
      shows={shows}
      tabs={getPrefs(ctx, user.id).tabs}
      user={user}
      users={users}
      folders={folders}
      adsEnabled={adsEnabled()}
      cache={user.isAdmin ? cacheStatus(ctx) : null}
      server={{
        version: env.version,
        devBuild: env.devBuild,
        updates: user.isAdmin ? updateStatus() : null,
        books: bookCount,
        scanRunning: ctx.scanState.running,
        lastScanAt: ctx.scanState.lastFinishedAt,
        lastScanError: ctx.scanState.lastError,
        watcher: ctx.watcher.mode(),
      }}
    />
  );
}
