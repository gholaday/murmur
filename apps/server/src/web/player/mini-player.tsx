"use client";

import { Cover } from "../cover";
import { chapterAt, timeLeft } from "@murmur/shared/client";
import { useCast } from "../cast/cast";
import { CastIcon, NextChapterIcon, PauseIcon, PlayIcon, PrevChapterIcon, SkipBackIcon, SkipForwardIcon } from "../icons";
import { type Playable, usePlayerControls, usePlayerSelect, usePosition, useTint } from "./engine";

/** Floating player above the tabs, on phones (wide screens have the player bar). */
export function MiniPlayer() {
  const item = usePlayerSelect((p) => p.item);
  const playing = usePlayerSelect((p) => p.playing);
  const loading = usePlayerSelect((p) => p.loading);
  const skip = usePlayerSelect((p) => p.skip);
  const { toggle, skipBy, setExpanded, trackStep } = usePlayerControls();
  const tint = useTint(item);
  if (!item) return null;

  const song = item.type === "track";

  return (
    <div
      className="mini"
      role="region"
      aria-label="Now playing"
      style={
        {
          ...(tint ? { "--tint": tint } : {}),
          ...(item.coverPath ? { "--art": `url("${item.coverPath}")` } : {}),
        } as React.CSSProperties
      }
    >
      <div className="mini-row">
        <button type="button" className="mini-open" onClick={() => setExpanded(true)} aria-label={`Open player: ${item.title}`}>
          <Cover src={item.coverPath} color={item.color} title={item.title} className="mini-cover" />
          <MiniText item={item} />
        </button>
        {song ? (
          <button type="button" className="mini-skip" onClick={() => trackStep(-1)} aria-label="Previous song">
            <PrevChapterIcon size={24} />
          </button>
        ) : (
          <button type="button" className="mini-skip" onClick={() => skipBy(-skip.back)} aria-label={`Skip back ${skip.back} seconds`}>
            <SkipBackIcon size={30} />
            <span>{skip.back}</span>
          </button>
        )}
        <button type="button" className="icon-btn" onClick={toggle} aria-label={playing ? "Pause" : "Play"} data-loading={loading || undefined}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        {song ? (
          <button type="button" className="mini-skip" onClick={() => trackStep(1)} aria-label="Next song">
            <NextChapterIcon size={24} />
          </button>
        ) : (
          <button type="button" className="mini-skip" onClick={() => skipBy(skip.forward)} aria-label={`Skip forward ${skip.forward} seconds`}>
            <SkipForwardIcon size={30} />
            <span>{skip.forward}</span>
          </button>
        )}
      </div>
      <MiniProgress item={item} />
    </div>
  );
}

/** The title and the line under it, or the error, or the device it's casting to. The player bar shows the same. */
export function MiniText({ item, scrub = null }: { item: Playable; scrub?: number | null }) {
  const error = usePlayerSelect((p) => p.error);
  const castDevice = useCast().device;
  return (
    <span className="mini-text">
      <span className="mini-title">{item.title}</span>
      {error ? (
        <span className="mini-sub error">{error}</span>
      ) : castDevice ? (
        <span className="mini-sub mini-cast">
          <CastIcon size={13} />
          {castDevice}
        </span>
      ) : (
        <MiniLine item={item} scrub={scrub} />
      )}
    </span>
  );
}

// The two parts that follow the playhead sit in their own components, so a tick redraws only them.

/** The line under the title. */
function MiniLine({ item, scrub }: { item: Playable; scrub: number | null }) {
  const position = usePosition();
  const pos = scrub ?? position;
  const dur = item.durationSec || 0;
  const chapterLine = item.chapters.length > 1 ? item.chapters[chapterAt(item.chapters, pos)]?.title : null;
  // A song shows its artist; a book or episode the time left.
  const leftLine = item.type === "track" ? item.subtitle : dur ? timeLeft(dur, pos) : item.subtitle;
  if (chapterLine) {
    // A book's chapter and time left share a line, like the app; a long chapter name gives way first.
    return (
      <span className="mini-sub mini-split">
        <span>{chapterLine}</span>
        {leftLine ? <span className="mini-time">{leftLine}</span> : null}
      </span>
    );
  }
  return leftLine ? <span className="mini-sub">{leftLine}</span> : null;
}

/** The thin progress line along the bottom. */
function MiniProgress({ item }: { item: Playable }) {
  const position = usePosition();
  const dur = item.durationSec || 0;
  const done = dur ? Math.min(1, position / dur) : 0;
  return <div className="mini-bar" style={{ transform: `scaleX(${done})` }} />;
}
