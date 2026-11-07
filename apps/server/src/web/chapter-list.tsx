"use client";

import { memo } from "react";
import { type ChapterDto, duration } from "@murmur/shared/client";
import { MixerBars } from "./mixer";

/**
 * A book's or episode's chapters, the ones before `current` dimmed. Memoized so a long list
 * redraws when the chapter changes, not on every playhead tick. With `playing` set, the current
 * chapter shows the playing bars instead of its number.
 */
export const ChapterList = memo(function ChapterList({
  chapters,
  current,
  playing,
  onPick,
}: {
  chapters: ChapterDto[];
  current: number;
  playing?: boolean;
  onPick: (startSec: number) => void;
}) {
  return (
    <ol className="chapter-list">
      {chapters.map((c, i) => (
        <li key={c.index} className={i < current ? "done" : undefined}>
          <button type="button" aria-current={i === current || undefined} onClick={() => onPick(c.startSec)}>
            <span className="chapter-num">{i === current && playing !== undefined ? <MixerBars playing={playing} /> : i + 1}</span>
            <span className="chapter-title">{c.title}</span>
            <span className="muted small">{duration(c.endSec - c.startSec)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
});
