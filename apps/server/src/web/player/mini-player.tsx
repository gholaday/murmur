"use client";

import { useState } from "react";
import { Cover } from "../cover";
import { clock, timeLeft } from "@murmur/shared/client";
import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from "../icons";
import { chapterAt, usePlayer, usePosition } from "./engine";

/**
 * Floating player above the tabs. On desktop it grows on hover to reveal a seek bar,
 * so you can scrub without opening the full player.
 */
export function MiniPlayer() {
  const { item, playing, loading, error, toggle, skipBy, skip, seek, setExpanded } = usePlayer();
  const position = usePosition();
  const [scrub, setScrub] = useState<number | null>(null);
  if (!item) return null;

  const pos = scrub ?? position;
  const dur = item.durationSec || 0;
  const chapter = item.chapters[chapterAt(item.chapters, pos)];
  const pct = dur ? Math.min(100, (pos / dur) * 100) : 0;
  const detail = error
    ? error
    : [item.chapters.length > 1 ? chapter?.title : null, dur ? timeLeft(dur, pos) : item.subtitle].filter(Boolean).join(" · ");
  const commit = () => {
    if (scrub !== null) seek(scrub);
    setScrub(null);
  };

  return (
    <div className="mini" role="region" aria-label="Now playing">
      <div className="mini-row">
        <button type="button" className="mini-open" onClick={() => setExpanded(true)} aria-label={`Open player: ${item.title}`}>
          <Cover src={item.coverUrl} color={item.color} title={item.title} className="mini-cover" />
          <span className="mini-text">
            <span className="mini-title">{item.title}</span>
            <span className={`mini-sub ${error ? "error" : ""}`}>{detail}</span>
          </span>
        </button>
        <button type="button" className="mini-skip" onClick={() => skipBy(-skip.back)} aria-label={`Skip back ${skip.back} seconds`}>
          <SkipBackIcon size={30} />
          <span>{skip.back}</span>
        </button>
        <button type="button" className="icon-btn" onClick={toggle} aria-label={playing ? "Pause" : "Play"} data-loading={loading || undefined}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button type="button" className="mini-skip" onClick={() => skipBy(skip.forward)} aria-label={`Skip forward ${skip.forward} seconds`}>
          <SkipForwardIcon size={30} />
          <span>{skip.forward}</span>
        </button>
      </div>
      {dur ? (
        <div className="mini-seek">
          <span>{clock(pos)}</span>
          <input
            type="range"
            className="scrubber mini-scrubber"
            aria-label="Position"
            min={0}
            max={Math.floor(dur)}
            step={1}
            value={Math.floor(pos)}
            style={{ "--pct": `${pct}%` } as React.CSSProperties}
            onChange={(e) => setScrub(Number(e.target.value))}
            onPointerUp={commit}
            onKeyUp={commit}
          />
          <span>-{clock(dur - pos)}</span>
        </div>
      ) : null}
      <div className="mini-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}
