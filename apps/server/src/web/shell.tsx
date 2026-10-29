"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { startCast } from "./cast/cast";
import { useDragToScroll } from "./drag-scroll";
import { useLiveChanges } from "./live-changes";
import type { UserPrefs } from "@murmur/shared/client";
import { AppIcon, LibraryIcon, MusicIcon, PodcastIcon, ProfileIcon, WatchIcon } from "./icons";
import { FullPlayer } from "./player/full-player";
import { MiniPlayer } from "./player/mini-player";
import { usePlayer } from "./player/engine";
import { VideoPlayer } from "./watch/video-player";
import { useVideo } from "./watch/video-session";

const TABS = [
  { href: "/", label: "Books", Icon: LibraryIcon, match: (p: string) => p === "/" || p.startsWith("/book") },
  { href: "/podcasts", label: "Podcasts", Icon: PodcastIcon, match: (p: string) => p.startsWith("/podcasts") },
  { href: "/music", label: "Music", Icon: MusicIcon, match: (p: string) => p.startsWith("/music") },
  { href: "/watch", label: "Watch", Icon: WatchIcon, match: (p: string) => p.startsWith("/watch") },
  { href: "/you", label: "You", Icon: ProfileIcon, match: (p: string) => p.startsWith("/you") },
];

/** Bottom tabs on phones, a sidebar on wide screens, and the player on top of both. */
export function Shell({
  tabs,
  hasMusic,
  hasWatch,
  children,
}: {
  tabs: UserPrefs["tabs"];
  hasMusic: boolean;
  hasWatch: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { item } = usePlayer();
  useDragToScroll();
  useLiveChanges();
  // Looks for Chromecasts; Chromium browsers only, and nothing shows until one is found.
  useEffect(() => startCast(), []);
  // Podcasts, Music and Watch can be switched off in You; Music and Watch also need something on the server.
  const shown = TABS.filter(
    (t) =>
      (t.href !== "/podcasts" || tabs.podcasts) &&
      (t.href !== "/music" || (tabs.music && hasMusic)) &&
      (t.href !== "/watch" || (tabs.watch !== false && hasWatch)),
  );
  const video = useVideo();
  // The video player has the whole screen on its own page, and is the mini player everywhere else.
  const watching = pathname.startsWith("/watch/play/");
  const miniVideo = !!video.item && !watching;
  return (
    <div className={`shell ${item || miniVideo ? "has-player" : ""}`}>
      <nav className="tabs" aria-label="Main">
        <div className="tabs-brand">
          <AppIcon />
          Murmur
        </div>
        {shown.map(({ href, label, Icon, match }) => (
          <Link key={href} href={href} className="tab" aria-current={match(pathname) ? "page" : undefined}>
            <Icon />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      <main className="page">{children}</main>
      <MiniPlayer />
      <FullPlayer />
      {video.item ? <VideoPlayer key={video.item.progressId} item={video.item} autoplay={video.autoplay} mini={miniVideo} /> : null}
    </div>
  );
}
