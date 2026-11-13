"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { startCast } from "./cast/cast";
import { useDragToScroll } from "./drag-scroll";
import { useWide } from "./layout";
import { useLiveChanges } from "./live-changes";
import type { UserPrefs } from "@murmur/shared/client";
import { AppIcon, CloseIcon, LibraryIcon, MusicIcon, PodcastIcon, ProfileIcon, SearchIcon, WatchIcon } from "./icons";
import { SearchProvider, useSearchState } from "./search/search-state";
import { FullPlayer } from "./player/full-player";
import { MiniPlayer } from "./player/mini-player";
import { NowPlaying } from "./player/now-playing";
import { PlayerBar } from "./player/player-bar";
import { SidePanel } from "./player/side-panel";
import { usePlayerControls, usePlayerSelect } from "./player/engine";
import { VideoPlayer } from "./watch/video-player";
import { useVideo } from "./watch/video-session";

const TABS = [
  { href: "/", label: "Books", Icon: LibraryIcon, match: (p: string) => p === "/" || p.startsWith("/book") },
  { href: "/podcasts", label: "Podcasts", Icon: PodcastIcon, match: (p: string) => p.startsWith("/podcasts") },
  { href: "/music", label: "Music", Icon: MusicIcon, match: (p: string) => p.startsWith("/music") },
  { href: "/watch", label: "Watch", Icon: WatchIcon, match: (p: string) => p.startsWith("/watch") },
  { href: "/you", label: "You", Icon: ProfileIcon, match: (p: string) => p.startsWith("/you") },
];

/**
 * A bottom bar of Search and the tabs on phones, with the player on top. On wide screens a grid
 * (shell.css): the sidebar, the page, a side panel slot on the right and a bar slot along the bottom.
 */
export function Shell({
  tabs,
  children,
}: {
  tabs: UserPrefs["tabs"];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const item = usePlayerSelect((p) => p.item);
  const expanded = usePlayerSelect((p) => p.expanded);
  const { setExpanded } = usePlayerControls();
  const wide = useWide();
  // On wide screens Now playing covers the page, which waits underneath, scrolled where it was.
  const nowPlaying = wide && expanded && !!item;
  useDragToScroll();
  useLiveChanges();
  // Looks for Chromecasts; Chromium browsers only, and nothing shows until one is found.
  useEffect(() => startCast(), []);
  // Everything but You shows as you've set it in You > Tabs.
  const shown = TABS.filter(
    (t) => (t.href !== "/" || tabs.books !== false) && (t.href !== "/podcasts" || tabs.podcasts) && (t.href !== "/music" || tabs.music) && (t.href !== "/watch" || tabs.watch),
  );
  const video = useVideo();
  // The video player has the whole screen on its own page, and is the mini player everywhere else.
  // On wide screens it takes the page area there instead, and the bar slot everywhere.
  const watching = pathname.startsWith("/watch/play/");
  const miniVideo = !!video.item && !watching;
  // The bar starts opening or closing Search on the tap, not once the page has changed.
  const [heading, setHeading] = useState<"open" | "closed" | null>(null);
  useEffect(() => setHeading(null), [pathname]);
  const searching = heading ? heading === "open" : pathname.startsWith("/search");
  return (
    <SearchProvider>
      <div className={`shell ${item || miniVideo ? "has-player" : ""}`}>
        <nav
          className={`tabs${searching ? " searching" : ""}`}
          aria-label="Main"
          // A tab closes Now playing, even the one already showing underneath it.
          onClick={(e) => nowPlaying && (e.target as Element).closest("a") && setExpanded(false)}
        >
          <div className="tabs-brand">
            <AppIcon />
            Murmur
          </div>
          <DockSearch searching={searching} onHeading={setHeading} />
          {shown.map(({ href, label, Icon, match }) => (
            <Link key={href} href={href} className="tab tab-hideable" aria-current={match(pathname) ? "page" : undefined}>
              <Icon />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <main className="page" inert={nowPlaying}>
          {children}
        </main>
        {/* The bar on wide screens, the floating mini player on phones (shell.css hides it from 900px before this knows). */}
        {wide ? <PlayerBar /> : <MiniPlayer />}
        {wide ? <SidePanel /> : null}
        {/* Expanded, the player covers the window on phones and the page area on wide screens. */}
        {wide ? <NowPlaying /> : <FullPlayer />}
        {video.item ? <VideoPlayer key={video.item.progressId} item={video.item} autoplay={video.autoplay} mini={miniVideo} /> : null}
      </div>
    </SearchProvider>
  );
}

/** Typing "/" anywhere but in a field. */
const isSlashKey = (e: KeyboardEvent) =>
  e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target as HTMLElement).closest("input, textarea, select, [contenteditable]");

/**
 * Search as the first tab. On phones, opening it grows its box out of the tab across the bar,
 * pushing the other tabs aside, with an X at the end; closing slides them back. In the
 * wide-screen sidebar the box is always there (and "/" jumps to it): typing in it opens the
 * search page.
 */
function DockSearch({ searching, onHeading }: { searching: boolean; onHeading: (to: "open" | "closed") => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const wide = useWide();
  const { query, setQuery, submit } = useSearchState();
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!wide) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isSlashKey(e)) return;
      e.preventDefault();
      field.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [wide]);
  const { setExpanded } = usePlayerControls();
  // The results show in the page, so Now playing gives way to them.
  const toSearch = () => {
    if (!wide) return;
    setExpanded(false);
    if (!pathname.startsWith("/search")) router.push("/search");
  };
  const close = () => {
    onHeading("closed");
    setQuery("");
    field.current?.blur();
    if (window.history.length > 1) router.back();
    else router.push("/");
  };
  return (
    <>
      <div className="dock-search">
        <Link
          href="/search"
          className="tab tab-search"
          aria-current={searching ? "page" : undefined}
          tabIndex={searching ? -1 : undefined}
          // Focused inside the tap, so phones open the keyboard as the box grows.
          onClick={() => {
            onHeading("open");
            field.current?.focus({ preventScroll: true });
          }}
        >
          <SearchIcon />
          <span>Search</span>
        </Link>
        <form
          className="dock-field"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
            field.current?.blur();
            toSearch();
          }}
        >
          <label className="search-field">
            <SearchIcon size={20} />
            <input
              ref={field}
              type="search"
              enterKeyHint="search"
              aria-label="Search"
              placeholder="Search"
              tabIndex={searching || wide ? undefined : -1}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                toSearch();
              }}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                if (wide) field.current?.blur();
                else close();
              }}
            />
            <kbd className="search-key" aria-hidden="true">
              /
            </kbd>
          </label>
        </form>
      </div>
      <button type="button" className="icon-btn dock-close" aria-label="Close search" tabIndex={searching ? undefined : -1} onClick={close}>
        <CloseIcon />
      </button>
    </>
  );
}
