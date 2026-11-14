"use client";

import { useState } from "react";
import { chapterAt, clock, timeLeft } from "@murmur/shared/client";
import { useBookmarks } from "../bookmarks";
import { type Playable, type PlayerApi, usePlayerControls } from "./engine";

/**
 * The position bar and its times. An episode's chapters split it into segments over the whole
 * episode; a book's bar spans the current chapter, like Pocket Casts. Without chapters it's the whole
 * item. Ad breaks and bookmarks are marked on it. The drag is the parent's (`scrub`), so the rest of
 * the player can follow where it would land; letting go seeks.
 */
export function Scrubber({
  item,
  pos,
  scrub,
  onScrub,
  marks,
  onChapters,
}: {
  item: Playable;
  /** The position shown: the drag's while dragging, else the playhead. */
  pos: number;
  scrub: number | null;
  onScrub: (sec: number | null) => void;
  /** Ad breaks to mark. */
  marks: PlayerApi["ads"];
  /** The chapter title in the times row was tapped. */
  onChapters: () => void;
}) {
  const { seek } = usePlayerControls();
  const bookmarks = useBookmarks(item.type, item.id);
  /** Where a mouse hovers over a chaptered bar, for the bubble. */
  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const ci = chapterAt(item.chapters, pos);
  const chapter = item.chapters[ci];
  const multiChapter = item.chapters.length > 1;
  const song = item.type === "track";
  const segmented = item.type === "episode" && multiChapter;
  const span =
    chapter && multiChapter && !segmented ? { start: chapter.startSec, end: chapter.endSec } : { start: 0, end: item.durationSec || 0 };
  const within = Math.max(0, pos - span.start);
  const spanLen = Math.max(1, span.end - span.start);
  const commitScrub = () => {
    if (scrub !== null) seek(scrub);
    onScrub(null);
  };
  // Hovering a mouse over the bar lights up that chapter's segment and shows its title in the
  // times row; a drag shows the chapter it would land in the same way. Both in accent.
  const hoverIndex = segmented && scrub === null && hoverAt !== null ? chapterAt(item.chapters, hoverAt) : -1;
  const lineIndex = hoverIndex >= 0 ? hoverIndex : ci;
  const previewing = hoverIndex >= 0 || (segmented && scrub !== null);
  const pct = (sec: number) => `${(Math.min(Math.max(sec - span.start, 0), spanLen) / spanLen) * 100}%`;
  const adMarks = marks.map((a) => (
    <div
      key={a.startSec}
      className="scrub-ad"
      style={
        {
          left: pct(a.startSec),
          width: `calc(${pct(a.endSec)} - ${pct(a.startSec)})`,
          "--heard": `${Math.min(100, Math.max(0, ((pos - a.startSec) / (a.endSec - a.startSec || 1)) * 100))}%`,
        } as React.CSSProperties
      }
    />
  ));

  return (
    <div className={`player-scrub${segmented ? " chaptered" : ""}`}>
      <div className={`scrub-wrap${scrub !== null ? " dragging" : ""}`}>
        {segmented ? (
          <div className="scrub-segs" aria-hidden="true">
            {item.chapters.map((c, i) => (
              <div
                key={c.index}
                className={`scrub-seg${i < ci ? " played" : i === ci ? " current" : i === hoverIndex ? " hovered" : ""}`}
                style={
                  {
                    left: pct(c.startSec),
                    // A 3px gap before the next chapter; a very short chapter stays a dot.
                    width: `max(2px, calc(${pct(c.endSec)} - ${pct(c.startSec)} - ${i < item.chapters.length - 1 ? 3 : 0}px))`,
                    "--fill": `${Math.min(100, Math.max(0, ((pos - c.startSec) / (c.endSec - c.startSec || 1)) * 100))}%`,
                  } as React.CSSProperties
                }
              />
            ))}
            {adMarks}
          </div>
        ) : (
          <div className="scrub-track" aria-hidden="true">
            <div className="scrub-played" style={{ width: pct(pos) }} />
            {adMarks}
          </div>
        )}
        {bookmarks.length ? (
          <div className="scrub-bookmarks" aria-hidden="true">
            {bookmarks
              .filter((b) => b.positionSec >= span.start && b.positionSec <= span.end)
              .map((b) => (
                <span key={b.id} style={{ left: pct(b.positionSec) }} />
              ))}
          </div>
        ) : null}
        <input
          type="range"
          className="scrubber"
          aria-label="Position"
          min={0}
          max={Math.floor(spanLen)}
          step={1}
          value={Math.min(Math.floor(within), Math.floor(spanLen))}
          onChange={(e) => onScrub(span.start + Number(e.target.value))}
          onPointerUp={commitScrub}
          onKeyUp={commitScrub}
          onPointerMove={(e) => {
            if (!segmented || e.pointerType !== "mouse") return;
            const r = e.currentTarget.getBoundingClientRect();
            setHoverAt(span.start + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * spanLen);
          }}
          onPointerLeave={() => setHoverAt(null)}
        />
      </div>
      <div className="player-times">
        <span>{clock(within)}</span>
        {/* With chapters, the playing one's title takes the middle; the time left is on the right anyway. */}
        {segmented && item.chapters[lineIndex] ? (
          <button type="button" className={`player-chapter-line${previewing ? " preview" : ""}`} onClick={onChapters}>
            {item.chapters[lineIndex]!.title}
          </button>
        ) : (
          <span>{item.durationSec && !song ? timeLeft(item.durationSec, pos) : ""}</span>
        )}
        <span>-{clock(spanLen - within)}</span>
      </div>
    </div>
  );
}
