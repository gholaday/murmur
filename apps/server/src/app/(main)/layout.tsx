import { getContext } from "@/server/context";
import { getPrefs } from "@/server/prefs";
import { requirePageUser } from "@/server/session";
import { PlayerProvider } from "@/web/player/engine";
import { Shell } from "@/web/shell";
import { VideoProvider } from "@/web/watch/video-session";

/** Everything behind sign-in shares one player, so audio keeps going between pages. */
export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const ctx = await getContext();
  return (
    <PlayerProvider>
      <VideoProvider>
        <Shell tabs={getPrefs(ctx, user.id).tabs}>
          {children}
        </Shell>
      </VideoProvider>
    </PlayerProvider>
  );
}
