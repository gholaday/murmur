"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type BookmarkDto, chapterAt, type ChapterDto, FALLBACK_TINT, timeLeft } from "@murmur/shared/client";
import { BookmarkNoteSheet } from "../bookmark-rows";
import { useBookmarks } from "../bookmarks";
import { CastButton } from "../cast/cast-button";
import { Cover } from "../cover";
import { DownIcon, MoreIcon } from "../icons";
import { Marquee } from "../marquee";
import { SectionTitle } from "../ui";
import { BookmarkButton } from "./bookmark-button";
import { type Playable, usePlayerControls, usePlayerSelect, usePosition, useTint } from "./engine";
import { NowBookmarks } from "./now-lists";
import { CoverPills, GoBackCard, MoreSheets, useAdMarks, usePlayingFrom } from "./player-parts";
import { useSidePanel } from "./side-panel";
import { SleepSheet } from "./sleep";
import { PlayerTiles, type TileSheet } from "./tiles";

/**
 * Now playing on wide screens: the player's `expanded` view, over the page area only, so the
 * sidebar, the player bar (which has the controls) and the side panel stay usable. The page
 * underneath stays mounted and keeps its scroll. The down arrow, Escape and going to another
 * page close it.
 */
export function NowPlaying() {
  const item = usePlayerSelect((p) => p.item);
  const expanded = usePlayerSelect((p) => p.expanded);
  if (!item || !expanded) return null;
  return <NowPlayingView item={item} />;
}

function NowPlayingView({ item }: { item: Playable }) {
  const { setExpanded } = usePlayerControls();
  const tint = useTint(item);
  const panel = useSidePanel(item);
  const [sheet, setSheet] = useState<null | "sleep" | "more" | "ads">(null);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [editingBookmark, setEditingBookmark] = useState<{ bookmark: BookmarkDto; isNew: boolean } | null>(null);
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const speedOpenRef = useRef(false);
  speedOpenRef.current = speedOpen;
  const floatingRef = useRef(false);
  floatingRef.current = panel.open && !panel.roomy;

  // Going to another page closes it.
  const pathname = usePathname();
  const [openedAt] = useState(pathname);
  useEffect(() => {
    if (pathname !== openedAt) setExpanded(false);
  }, [pathname, openedAt, setExpanded]);

  // Escape closes it, once a sheet, a speed popover or the floating side panel has had it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (speedOpenRef.current) setSpeedOpen(false);
      else if (!document.querySelector("dialog[open], .speed-pop") && !floatingRef.current && !(e.target as Element).closest?.("input, textarea, select")) setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setExpanded]);

  // Focus starts on the close button, and goes back to the bar's button when it closes from inside.
  useLayoutEffect(() => {
    const root = ref.current;
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      const at = document.activeElement;
      if (!at || at === document.body || root?.contains(at)) document.querySelector<HTMLElement>(".pbar-expand")?.focus({ preventScroll: true });
    };
  }, []);

  const onTile = (to: TileSheet) => (to === "sleep" ? setSheet("sleep") : panel.toggle(to));

  return (
    <section ref={ref} className="now" aria-label="Now playing" style={{ "--tint": tint ?? FALLBACK_TINT.artwork } as React.CSSProperties}>
      <GoBackCard />
      <div className="now-scroll">
        <div className="now-top">
          <button ref={closeRef} type="button" className="icon-btn" onClick={() => setExpanded(false)} aria-label="Close now playing">
            <DownIcon />
          </button>
          <div className="player-top-end">
            <CastButton />
            <button type="button" className="icon-btn" onClick={() => setSheet("more")} aria-label="More options">
              <MoreIcon />
            </button>
          </div>
        </div>
        <div className="now-body">
          <NowMain
            item={item}
            tiles={
              <PlayerTiles item={item} speedOpen={speedOpen} onSpeedOpen={setSpeedOpen} onSheet={onTile} panelTab={panel.open ? panel.tab : null} />
            }
            onEditBookmark={setEditingBookmark}
          />
          {item.type === "track" ? null : <NowBookmarksSection item={item} />}
        </div>
      </div>

      <SleepSheet open={sheet === "sleep"} onClose={() => setSheet(null)} />
      <BookmarkNoteSheet bookmark={editingBookmark?.bookmark ?? null} isNew={editingBookmark?.isNew} onClose={() => setEditingBookmark(null)} />
      <MoreSheets item={item} sheet={sheet === "more" || sheet === "ads" ? sheet : null} onSheet={setSheet} />
    </section>
  );
}

/**
 * The cover and everything beside it that follows the playhead: where it's playing from, the
 * title, the chapter overview and line, the pills and the tiles (the sleep tile counts down).
 */
function NowMain({
  item,
  tiles,
  onEditBookmark,
}: {
  item: Playable;
  tiles: React.ReactNode;
  onEditBookmark: (edit: { bookmark: BookmarkDto; isNew: boolean }) => void;
}) {
  const pos = usePosition();
  const marks = useAdMarks(item);
  const from = usePlayingFrom(item, pos);
  const song = item.type === "track";
  const chapters = item.chapters.length > 1 ? item.chapters : null;
  const ci = chapterAt(item.chapters, pos);
  const left = !song && item.durationSec ? timeLeft(item.durationSec, pos) : null;
  return (
    <div className="now-main">
      <div className="now-cover">
        <Cover src={item.coverPathLarge} color={item.color} title={item.title} subtitle={item.subtitle} className="player-cover" large />
        <CoverPills item={item} pos={pos} marks={marks} />
      </div>
      <div className="now-info">
        <div className="player-from">{from}</div>
        <div className="player-info-row">
          <div className="player-info">
            <h1 className="player-title">
              <Marquee text={item.title} />
            </h1>
            {item.subtitle ? <div className="player-sub">{item.subtitle}</div> : null}
          </div>
          {song ? null : <BookmarkButton item={item} pos={pos} onEdit={onEditBookmark} />}
        </div>
        {chapters ? (
          <>
            <ChapterOverview chapters={chapters} current={ci} pos={pos} />
            <div className="now-chapter">{chapters[ci]?.title}</div>
          </>
        ) : null}
        {left || chapters ? (
          <div className="pills now-pills">
            {left ? <span className="pill">{left}</span> : null}
            {chapters ? (
              <span className="pill">
                Chapter {ci + 1} of {chapters.length}
              </span>
            ) : null}
          </div>
        ) : null}
        {tiles}
      </div>
    </div>
  );
}

/** One segment per chapter: those heard in accent, the current one taller and filled as far as it's played. */
function ChapterOverview({ chapters, current, pos }: { chapters: ChapterDto[]; current: number; pos: number }) {
  const c = chapters[current];
  const fill = c ? Math.min(100, Math.max(0, ((pos - c.startSec) / (c.endSec - c.startSec || 1)) * 100)) : 0;
  return (
    <div className="now-segs" aria-hidden="true">
      {chapters.map((ch, i) => (
        <span
          key={ch.index}
          className={i < current ? "played" : i === current ? "current" : undefined}
          style={i === current ? ({ "--fill": `${fill}%` } as React.CSSProperties) : undefined}
        />
      ))}
    </div>
  );
}

function NowBookmarksSection({ item }: { item: Playable }) {
  const bookmarks = useBookmarks(item.type, item.id);
  return (
    <section className="now-bookmarks" aria-label="Bookmarks">
      <SectionTitle title="Bookmarks" count={bookmarks.length || undefined} noun="bookmark" />
      <NowBookmarks />
    </section>
  );
}
