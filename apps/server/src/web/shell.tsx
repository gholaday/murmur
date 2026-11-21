"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { librarySections, type LibrarySection, storageKeys, type UserPrefs } from "@murmur/shared/client";
import { startCast } from "./cast/cast";
import { useDragToScroll } from "./drag-scroll";
import { useLiveChanges } from "./live-changes";
import { AppIcon, LibraryIcon, PodcastIcon, ProfileIcon, SearchIcon } from "./icons";
import { forgetLikes } from "./music/likes";
import { FullPlayer } from "./player/full-player";
import { MiniPlayer } from "./player/mini-player";
import { usePlayerSelect } from "./player/engine";
import { VideoPlayer } from "./watch/video-player";
import { useVideo } from "./watch/video-session";

/** Where each Library section lives. */
export const SECTION_HREF: Record<LibrarySection, string> = { books: "/", music: "/music", watch: "/watch" };

/** The Library section a page belongs to, or null outside Library. The video player isn't in it. */
function sectionOf(pathname: string): LibrarySection | null {
  if (pathname === "/" || pathname.startsWith("/book")) return "books";
  if (pathname.startsWith("/music")) return "music";
  if (pathname.startsWith("/watch") && !pathname.startsWith("/watch/play/")) return "watch";
  return null;
}

/** A tab's own page, where phones show the bottom bar; pages opened from one hide it, as in the app. */
function isTabRoot(pathname: string): boolean {
  if (["/", "/music", "/watch", "/podcasts", "/search", "/you"].includes(pathname)) return true;
  // You's settings tabs are You itself; /you/hidden is opened from it.
  return /^\/you\/[^/]+$/.test(pathname) && pathname !== "/you/hidden" && pathname !== "/you/stats";
}

const TabsContext =createContext<UserPrefs["tabs"]>({ podcasts: false });

/** What's switched on in You > Tabs. */
export const useTabPrefs = () => useContext(TabsContext);

function readSection(): LibrarySection | null {
  try {
    return localStorage.getItem(storageKeys.librarySection) as LibrarySection | null;
  } catch {
    return null;
  }
}

/** A bottom bar of Search, Library, Podcasts and You on phones, a sidebar on wide screens, and the player on top of both. */
export function Shell({ tabs, children }: { tabs: UserPrefs["tabs"]; children: React.ReactNode }) {
  const pathname = usePathname();
  const item = usePlayerSelect((p) => p.item);
  useDragToScroll();
  useLiveChanges();
  // Looks for Chromecasts; Chromium browsers only, and nothing shows until one is found.
  useEffect(() => startCast(), []);
  // Each page's data is newer than the likes the last page noted.
  useEffect(() => forgetLikes(), [pathname]);

  // Library opens the section you were last in.
  const sections = librarySections(tabs);
  const here = sectionOf(pathname);
  const [last, setLast] = useState<LibrarySection | null>(null);
  useEffect(() => {
    if (here) {
      setLast(here);
      try {
        localStorage.setItem(storageKeys.librarySection, here);
      } catch {
        // Blocked storage: Library just opens its first section.
      }
    } else setLast((l) => l ?? readSection());
  }, [here]);
  const libraryHref = SECTION_HREF[last && sections.includes(last) ? last : (sections[0] ?? "books")];

  const items = [
    { href: "/search", label: "Search", Icon: SearchIcon, current: pathname.startsWith("/search"), shown: true },
    { href: libraryHref, label: "Library", Icon: LibraryIcon, current: here !== null, shown: sections.length > 0 },
    { href: "/podcasts", label: "Podcasts", Icon: PodcastIcon, current: pathname.startsWith("/podcasts"), shown: !!tabs.podcasts },
    { href: "/you", label: "You", Icon: ProfileIcon, current: pathname.startsWith("/you"), shown: true },
  ].filter((t) => t.shown);

  const video = useVideo();
  // The video player has the whole screen on its own page, and is the mini player everywhere else.
  const watching = pathname.startsWith("/watch/play/");
  const miniVideo = !!video.item && !watching;
  return (
    <TabsContext.Provider value={tabs}>
      <div className={`shell ${item || miniVideo ? "has-player" : ""} ${isTabRoot(pathname) ? "" : "nested"}`}>
        <nav className="tabs" aria-label="Main">
          <div className="tabs-brand">
            <AppIcon />
            Murmur
          </div>
          {items.map(({ href, label, Icon, current }) => (
            <Link key={label} href={href} className="tab" aria-current={current ? "page" : undefined}>
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
    </TabsContext.Provider>
  );
}
