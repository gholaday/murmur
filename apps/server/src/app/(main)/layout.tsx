import { requirePageUser } from "@/server/session";
import { PlayerProvider } from "@/web/player/engine";
import { Shell } from "@/web/shell";

/** Everything behind sign-in shares one player, so audio keeps going between pages. */
export default async function MainLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser();
  return (
    <PlayerProvider>
      <Shell>{children}</Shell>
    </PlayerProvider>
  );
}
