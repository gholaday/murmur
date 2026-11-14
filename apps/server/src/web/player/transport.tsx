"use client";

import { bookFinished } from "@murmur/shared/client";
import {
  NextChapterIcon,
  PauseIcon,
  PlayIcon,
  PrevChapterIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "../icons";
import { type Playable, usePlayerControls, usePlayerSelect } from "./engine";

/**
 * The play button and the buttons either side of it. Books and episodes: previous chapter, skip back,
 * play, skip forward, next chapter. Songs: repeat, previous, play, next, shuffle.
 */
export function Transport({ item, pos }: { item: Playable; pos: number }) {
  const p = usePlayerControls();
  const playing = usePlayerSelect((s) => s.playing);
  const loading = usePlayerSelect((s) => s.loading);
  const repeat = usePlayerSelect((s) => s.repeat);
  const shuffle = usePlayerSelect((s) => s.shuffle);
  const skip = usePlayerSelect((s) => s.skip);
  const song = item.type === "track";
  const multiChapter = item.chapters.length > 1;
  // Without chapters, an episode's outer buttons step through Up Next and then its show.
  const inList = item.type !== "book";
  return (
    <div className="player-controls">
      {song ? (
        <>
          <button
            type="button"
            className={`icon-btn dim${repeat !== "off" ? " on" : ""}`}
            onClick={p.cycleRepeat}
            aria-label={repeat === "one" ? "Repeat song" : repeat === "all" ? "Repeat all" : "Repeat off"}
          >
            {repeat === "one" ? <RepeatOneIcon /> : <RepeatIcon />}
          </button>
          <button type="button" className="skip-btn" onClick={() => p.trackStep(-1)} aria-label="Previous song">
            <PrevChapterIcon size={32} />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="icon-btn dim"
            onClick={() => p.chapterStep(-1)}
            aria-label={multiChapter ? "Previous chapter" : inList ? "Previous" : "Back 30 seconds"}
          >
            <PrevChapterIcon />
          </button>
          <button type="button" className="skip-btn" onClick={() => p.skipBy(-skip.back)} aria-label={`Skip back ${skip.back} seconds`}>
            <SkipBackIcon size={36} />
            <span>{skip.back}</span>
          </button>
        </>
      )}
      <button
        type="button"
        className="play-btn"
        onClick={p.toggle}
        aria-label={bookFinished(item.type, item.durationSec, pos, playing || loading) ? "Play from the start" : playing ? "Pause" : "Play"}
        data-loading={loading || undefined}
      >
        {playing ? <PauseIcon size={32} /> : <PlayIcon size={32} />}
      </button>
      {song ? (
        <>
          <button type="button" className="skip-btn" onClick={() => p.trackStep(1)} aria-label="Next song">
            <NextChapterIcon size={32} />
          </button>
          <button type="button" className={`icon-btn dim${shuffle ? " on" : ""}`} onClick={p.toggleShuffle} aria-label="Shuffle" aria-pressed={shuffle}>
            <ShuffleIcon />
          </button>
        </>
      ) : (
        <>
          <button type="button" className="skip-btn" onClick={() => p.skipBy(skip.forward)} aria-label={`Skip forward ${skip.forward} seconds`}>
            <SkipForwardIcon size={36} />
            <span>{skip.forward}</span>
          </button>
          <button
            type="button"
            className="icon-btn dim"
            onClick={() => p.chapterStep(1)}
            aria-label={multiChapter ? "Next chapter" : inList ? "Next" : "Forward 30 seconds"}
          >
            <NextChapterIcon />
          </button>
        </>
      )}
    </div>
  );
}
