"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppIcon, LibraryIcon, PodcastIcon, QueueIcon, SettingsIcon } from "./icons";
import { FullPlayer } from "./player/full-player";
import { MiniPlayer } from "./player/mini-player";
import { usePlayer } from "./player/engine";

const TABS = [
  { href: "/", label: "Library", Icon: LibraryIcon, match: (p: string) => p === "/" || p.startsWith("/book") },
  { href: "/podcasts", label: "Podcasts", Icon: PodcastIcon, match: (p: string) => p.startsWith("/podcasts") },
  { href: "/up-next", label: "Up Next", Icon: QueueIcon, match: (p: string) => p.startsWith("/up-next") },
  { href: "/settings", label: "Settings", Icon: SettingsIcon, match: (p: string) => p.startsWith("/settings") },
];

/** Bottom tabs on phones, a sidebar on wide screens, and the player on top of both. */
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { item, queue } = usePlayer();
  return (
    <div className={`shell ${item ? "has-player" : ""}`}>
      <nav className="tabs" aria-label="Main">
        <div className="tabs-brand">
          <AppIcon />
          Murmur
        </div>
        {TABS.map(({ href, label, Icon, match }) => (
          <Link key={href} href={href} className="tab" aria-current={match(pathname) ? "page" : undefined}>
            <Icon />
            <span>{label}</span>
            {href === "/up-next" && queue.length > 0 ? <span className="tab-count">{queue.length}</span> : null}
          </Link>
        ))}
      </nav>
      <main className="page">{children}</main>
      <MiniPlayer />
      <FullPlayer />
    </div>
  );
}
