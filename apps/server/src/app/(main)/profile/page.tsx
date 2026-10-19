import type { UserDto } from "@murmur/shared";
import { getContext } from "@/server/context";
import { env } from "@/server/env";
import { requirePageUser } from "@/server/session";
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
  return (
    <ProfileView
      user={user}
      users={users}
      server={{
        version: env.version,
        books: bookCount,
        scanRunning: ctx.scanState.running,
        lastScanAt: ctx.scanState.lastFinishedAt,
        lastScanError: ctx.scanState.lastError,
        watcher: ctx.watcher.mode(),
      }}
    />
  );
}
