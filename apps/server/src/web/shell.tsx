"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDragToScroll } from "./drag-scroll";
import type { UserPrefs } from "@murmur/shared/client";
import { AppIcon, LibraryIcon, MusicIcon, PodcastIcon, ProfileIcon, QueueIcon } from "./icons";
import { FullPlayer } from "./player/full-player";
import { MiniPlayer } from "./player/mini-player";
import { usePlayer } from "./player/engine";

const TABS = [
  { href: "/", label: "Books", Icon: LibraryIcon, match: (p: string) => p === "/" || p.startsWith("/book") },
  { href: "/podcasts", label: "Podcasts", Icon: PodcastIcon, match: (p: string) => p.startsWith("/podcasts") },
  { href: "/music", label: "Music", Icon: MusicIcon, match: (p: string) => p.startsWith("/music") },
  { href: "/listening", label: "Listening", Icon: QueueIcon, match: (p: string) => p.startsWith("/listening") },
  { href: "/you", label: "You", Icon: ProfileIcon, match: (p: string) => p.startsWith("/you") },
];

/** Bottom tabs on phones, a sidebar on wide screens, and the player on top of both. */
export function Shell({ tabs, hasMusic, children }: { tabs: UserPrefs["tabs"]; hasMusic: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const { item, queue } = usePlayer();
  useDragToScroll();
  // Podcasts and Music can be switched off in You; Music also needs music on the server.
  const shown = TABS.filter((t) => (t.href !== "/podcasts" || tabs.podcasts) && (t.href !== "/music" || (tabs.music && hasMusic)));
  return (
    <div className={`shell ${item ? "has-player" : ""}`}>
      <nav className="tabs" aria-label="Main">
        <div className="tabs-brand">
          <AppIcon />
          Murmur
        </div>
        {shown.map(({ href, label, Icon, match }) => (
          <Link key={href} href={href} className="tab" aria-current={match(pathname) ? "page" : undefined}>
            <Icon />
            <span>{label}</span>
            {href === "/listening" && queue.length > 0 ? <span className="tab-count">{queue.length}</span> : null}
          </Link>
        ))}
      </nav>
      <main className="page">{children}</main>
      <MiniPlayer />
      <FullPlayer />
    </div>
  );
}
