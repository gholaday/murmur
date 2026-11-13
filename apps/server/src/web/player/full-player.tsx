"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Cover } from "../cover";
import { Marquee } from "../marquee";
import { bookFinished, type BookmarkDto, chapterAt, clock, showMarkPlayed, FALLBACK_TINT } from "@murmur/shared/client";
import { BookmarkNoteSheet } from "../bookmark-rows";
import { CheckIcon, CloseIcon, ChevronIcon, DownIcon, MoreIcon, NextChapterIcon } from "../icons";
import { Sheet, SheetItem } from "../sheet";
import { Chip, Chips } from "../ui";
import { UpNextSheet } from "../up-next";
import { AD_MODES, adBreak, adModeFor, adPrefsStore, setShowMode, useAdPrefs } from "./ad-prefs";
import { CastButton } from "../cast/cast-button";
import { cssMs } from "../css-vars";
import { useWide } from "../layout";
import { useCast } from "../cast/cast";
import { playableHref, usePlayer, usePosition, useTint } from "./engine";
import { BookmarkButton } from "./bookmark-button";
import { NowBookmarksSheet, NowChaptersSheet } from "./now-lists";
import { Scrubber } from "./scrubber";
import { SleepSheet } from "./sleep";
import { PlayerTiles } from "./tiles";
import { Transport } from "./transport";
import { VolumeRow } from "./volume-control";

/**
 * On a phone, pulling the player's top bar or cover down drags the whole player with your finger;
 * let go far enough or fast enough and it slides away and minimises, otherwise it springs back.
 */
export function usePullToClose(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const [pulled, setPulled] = useState(false);
  const wide = useWide();
  const drag = useRef<{ y: number; t: number; dy: number; v: number } | null>(null);
  const settle = (el: HTMLElement, transform: string, easing: string) => {
    el.style.transition = `transform ${cssMs("--player-close")}ms ${easing}`;
    el.style.transform = transform;
  };
  const end = (e: React.PointerEvent, cancelled: boolean) => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d || !el) return;
    if (d.dy > 8) {
      // A pull isn't a tap: the button or Skip ad under the finger stays put.
      const swallow = (ev: Event) => ev.stopPropagation();
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    }
    if (!cancelled && (d.dy > el.clientHeight * 0.25 || d.v > 0.5)) {
      settle(el, "translateY(100%)", "ease-in");
      setPulled(true);
      setTimeout(onClose, cssMs("--player-close"));
    } else settle(el, "", "ease-out");
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || wide) return;
      drag.current = { y: e.clientY, t: e.timeStamp, dy: 0, v: 0 };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      const el = ref.current;
      if (!d || !el) return;
      const dy = Math.max(0, e.clientY - d.y);
      // Held only once it's a pull, so a tap still reaches the button under the finger.
      if (dy > 8 && !e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.setPointerCapture(e.pointerId);
      const dt = e.timeStamp - d.t;
      if (dt > 0) d.v = (dy - d.dy) / dt;
      d.dy = dy;
      d.t = e.timeStamp;
      el.style.transition = "none";
      el.style.transform = dy ? `translateY(${dy}px)` : "";
    },
    onPointerUp: (e: React.PointerEvent) => end(e, false),
    onPointerCancel: (e: React.PointerEvent) => end(e, true),
  };
  return { ref, pulled, setPulled, handlers };
}

export function FullPlayer() {
  const p = usePlayer();
  const castDevice = useCast().device;
  const [sheet, setSheet] = useState<null | "sleep" | "chapters" | "bookmarks" | "more" | "ads" | "upnext">(null);
  const [editingBookmark, setEditingBookmark] = useState<{ bookmark: BookmarkDto; isNew: boolean } | null>(null);
  const adPrefs = useAdPrefs();
  const [speedOpen, setSpeedOpen] = useState(false);
  /** Where the scrubber is being dragged to; the player follows it until it's let go. */
  const [scrub, setScrub] = useState<number | null>(null);
  const { item, expanded, setExpanded } = p;
  const tint = useTint(item);
  const speedOpenRef = useRef(false);
  speedOpenRef.current = speedOpen;
  // Minimizing plays the opening animation in reverse before the player unmounts.
  const [closing, setClosing] = useState(false);
  const [wasExpanded, setWasExpanded] = useState(expanded);
  const pull = usePullToClose(() => setExpanded(false));
  if (wasExpanded !== expanded) {
    setWasExpanded(expanded);
    setClosing(!expanded);
    if (expanded) pull.setPulled(false);
  }
  // Minimized, the player draws nothing, so it needn't redraw on every tick.
  const position = usePosition(expanded || closing);
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => setClosing(false), cssMs("--player-close"));
    return () => clearTimeout(t);
  }, [closing]);

  // Close with Escape and stop the page behind from scrolling.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
      if (speedOpenRef.current) setSpeedOpen(false);
      else setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [expanded, setExpanded]);

  if (!item || (!expanded && !closing)) return null;

  const pos = scrub ?? position;
  const ci = chapterAt(item.chapters, pos);
  const chapter = item.chapters[ci];
  const multiChapter = item.chapters.length > 1;
  // An episode's chapters are segments on the bar, so its line under the title stays the show.
  const segmented = item.type === "episode" && multiChapter;
  const closeSheet = () => setSheet(null);
  const choose = (fn: () => void) => () => {
    fn();
    closeSheet();
  };
  // Ads only ever exist for episodes, and their setting lives in More.
  const showAds = item.type === "episode" && p.adsEnabled;
  // Songs: previous and next instead of skips and chapters, no speed, no position kept.
  const song = item.type === "track";
  const adMode = adModeFor(adPrefs, item.podcastId);
  const marks = showAds && adMode !== "off" ? p.ads : [];
  const adIndex = marks.findIndex((a) => pos >= a.startSec && pos < a.endSec);
  const inAd = adIndex >= 0 ? adBreak(marks, adIndex) : null;
  // An ad that runs to the end leaves nothing to skip to once the time is up.
  const canSkipAd = inAd !== null && !(item.durationSec && item.durationSec - pos < 1);
  const markPlayed = showMarkPlayed(item.type, item.durationSec, pos);

  return (
    <div
      ref={pull.ref}
      className={`player${closing ? " closing" : ""}${pull.pulled ? " pulled" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Player"
      style={
        {
          "--tint": tint ?? FALLBACK_TINT.artwork,
          "--art": item.coverPathLarge ? `url("${item.coverPathLarge}")` : "none",
        } as React.CSSProperties
      }
    >
      {/* A blurred copy of the cover bleeding out behind it, below the top bar. */}
      <div className="player-bleed" aria-hidden="true" />
      <div className="player-top player-pull" {...pull.handlers}>
        <button type="button" className="icon-btn" onClick={() => setExpanded(false)} aria-label="Close player">
          <DownIcon />
        </button>
        <div className="player-from">
          {bookFinished(item.type, item.durationSec, pos, p.playing || p.loading)
            ? "Finished"
            : castDevice
              ? `Playing on ${castDevice}`
              : `Playing from ${song ? (p.upNext.source?.title ?? "Music") : item.type === "book" ? "Books" : "Podcasts"}`}
        </div>
        <div className="player-top-end">
          <CastButton />
          <button type="button" className="icon-btn" onClick={() => setSheet("more")} aria-label="More options">
            <MoreIcon />
          </button>
        </div>
      </div>
      {p.goBackTo !== null ? (
        <div className="float-card" role="status">
          <span>You were at {clock(p.goBackTo)}</span>
          <button type="button" className="more-link" onClick={p.goBack}>
            Go back
          </button>
          <button type="button" className="icon-btn dim" aria-label="Stay here" onClick={p.stayHere}>
            <CloseIcon size={18} />
          </button>
        </div>
      ) : null}

      <div className="player-main">
        {/* Skip ad and Mark played sit on the cover so they never move the controls. */}
        <div className="player-cover-wrap player-pull" {...pull.handlers}>
          <Cover src={item.coverPathLarge} color={item.color} title={item.title} subtitle={item.subtitle} className="player-cover" large />
          {canSkipAd || markPlayed ? (
            <div className="cover-pills">
              {markPlayed ? (
                // Marking it played closes the player, as reaching the end does.
                <button
                  type="button"
                  className="finish-pill"
                  onClick={() => {
                    void p.markCurrent(true);
                    toast("Marked as played");
                  }}
                >
                  Mark played
                  <CheckIcon size={16} />
                </button>
              ) : null}
              {canSkipAd ? (
                <button type="button" className="skip-ad" onClick={() => p.seek(inAd.endSec)}>
                  Skip ad
                  <NextChapterIcon size={16} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="player-info-row">
          <div className="player-info">
            <h1 className="player-title">
              <Marquee text={item.title} />
            </h1>
            <div className="player-sub">{multiChapter && !segmented && chapter ? chapter.title : item.subtitle}</div>
          </div>
          {song ? null : <BookmarkButton item={item} pos={pos} onEdit={setEditingBookmark} />}
        </div>

        <Scrubber item={item} pos={pos} scrub={scrub} onScrub={setScrub} marks={marks} onChapters={() => setSheet("chapters")} />
        <Transport item={item} pos={pos} />
        <VolumeRow />
        {p.error ? <p className="error player-error">{p.error}</p> : null}
      </div>

      <PlayerTiles item={item} speedOpen={speedOpen} onSpeedOpen={setSpeedOpen} onSheet={setSheet} />

      <UpNextSheet open={sheet === "upnext"} onClose={() => setSheet(null)} />

      <SleepSheet open={sheet === "sleep"} onClose={closeSheet} />
      <NowChaptersSheet open={sheet === "chapters"} onClose={closeSheet} />
      <NowBookmarksSheet open={sheet === "bookmarks"} onClose={closeSheet} />

      <BookmarkNoteSheet bookmark={editingBookmark?.bookmark ?? null} isNew={editingBookmark?.isNew} onClose={() => setEditingBookmark(null)} />

      <Sheet open={sheet === "ads"} onClose={() => setSheet(null)} title="Ads">
        <p className="sheet-note">This device only</p>
        {AD_MODES.map((m) => (
          <SheetItem key={m.id} active={adPrefs.mode === m.id} onClick={() => adPrefsStore.set({ ...adPrefs, mode: m.id })}>
            <span className="sheet-item-text">
              <span>{m.label}</span>
              <span className="sheet-item-sub">{m.hint}</span>
            </span>
          </SheetItem>
        ))}
        {item.podcastId ? (
          <div className="sheet-group">
            <div className="sheet-group-title">{item.subtitle ?? "This podcast"}</div>
            <Chips kind="radio" label="Ads for this podcast">
              {[{ id: null, label: "Default" }, ...AD_MODES].map((m) => (
                <Chip
                  key={m.id ?? "default"}
                  selected={(adPrefs.shows[item.podcastId!] ?? null) === m.id}
                  onClick={() => adPrefsStore.set(setShowMode(adPrefs, item.podcastId!, m.id))}
                >
                  {m.label}
                </Chip>
              ))}
            </Chips>
          </div>
        ) : null}
      </Sheet>

      <Sheet open={sheet === "more"} onClose={() => setSheet(null)} title={item.title}>
        <Link
          href={playableHref(item)}
          className="sheet-item"
          onClick={() => {
            setSheet(null);
            setExpanded(false);
          }}
        >
          Go to {song ? "album" : item.type === "book" ? "book" : "podcast"}
        </Link>
        {song ? null : (
          <>
            <SheetItem
              onClick={choose(() => {
                void p.markCurrent(true);
                toast(item.type === "book" ? "Marked as finished" : "Marked as played");
              })}
            >
              {item.type === "book" ? "Mark as finished" : "Mark played"}
            </SheetItem>
            <SheetItem onClick={choose(() => p.markCurrent(false))}>Start from the beginning</SheetItem>
            {showAds ? (
              <SheetItem onClick={() => setSheet("ads")}>
                <span className="sheet-item-grow">Ads</span>
                <span className="setting-value">
                  <span>{AD_MODES.find((m) => m.id === adMode)?.short}</span>
                  <ChevronIcon size={18} />
                </span>
              </SheetItem>
            ) : null}
          </>
        )}
        <SheetItem danger onClick={choose(() => p.stop())}>
          Stop playback
        </SheetItem>
      </Sheet>
    </div>
  );
}
