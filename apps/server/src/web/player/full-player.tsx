"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Cover } from "../cover";
import { clock, duration, timeLeft } from "@murmur/shared/client";
import {
  DownIcon,
  ListIcon,
  MinusIcon,
  MoonIcon,
  MoreIcon,
  NextChapterIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  PrevChapterIcon,
  QueueIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "../icons";
import { Sheet, SheetItem } from "../sheet";
import { chapterAt, usePlayer, usePosition, type SleepTimer } from "./engine";

const MIN_SPEED = 0.5;
const MAX_SPEED = 3;
/** The − and + buttons jump by this; the slider moves in 0.05 steps. */
const SPEED_STEP = 0.25;

const clampSpeed = (v: number) => Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(v * 100) / 100));
/** 1×, 1.25×, 1.5× — no trailing zeros. */
const speedText = (v: number) => `${Number(v.toFixed(2))}×`;
const SLEEP_MINUTES = [5, 10, 15, 30, 45, 60, 90];

function sleepLabel(sleep: SleepTimer, now: number): string {
  if (sleep.mode === "timer") return clock(Math.max(0, (sleep.endsAt - now) / 1000));
  if (sleep.mode === "chapter") return "Chapter end";
  return "Sleep";
}

export function FullPlayer() {
  const p = usePlayer();
  const position = usePosition();
  const [sheet, setSheet] = useState<null | "sleep" | "chapters" | "more">(null);
  const [speedOpen, setSpeedOpen] = useState(false);
  /** Slider value while dragging; saved once you let go. */
  const [speedDraft, setSpeedDraft] = useState<number | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const { item, expanded, setExpanded } = p;
  const speedOpenRef = useRef(false);
  speedOpenRef.current = speedOpen;

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

  if (!item || !expanded) return null;

  const pos = scrub ?? position;
  const ci = chapterAt(item.chapters, pos);
  const chapter = item.chapters[ci];
  const multiChapter = item.chapters.length > 1;
  // With chapters the bar spans the current chapter, like Pocket Casts; otherwise the whole item.
  const span = chapter && multiChapter ? { start: chapter.startSec, end: chapter.endSec } : { start: 0, end: item.durationSec || 0 };
  const within = Math.max(0, pos - span.start);
  const spanLen = Math.max(1, span.end - span.start);
  const pct = item.durationSec ? Math.round((pos / item.durationSec) * 100) : 0;
  const commitScrub = () => {
    if (scrub !== null) p.seek(scrub);
    setScrub(null);
  };
  const choose = (fn: () => void) => () => {
    fn();
    setSheet(null);
  };

  return (
    <div
      className="player"
      role="dialog"
      aria-modal="true"
      aria-label="Player"
      style={{ "--tint": item.color ?? "#3b4a6e" } as React.CSSProperties}
    >
      <div className="player-top">
        <button type="button" className="icon-btn" onClick={() => setExpanded(false)} aria-label="Close player">
          <DownIcon />
        </button>
        <div className="player-from">Playing from {item.type === "book" ? "Library" : "Podcasts"}</div>
        <button type="button" className="icon-btn" onClick={() => setSheet("more")} aria-label="More options">
          <MoreIcon />
        </button>
      </div>

      <div className="player-main">
        <Cover src={item.coverUrlLarge} color={item.color} title={item.title} subtitle={item.subtitle} className="player-cover" large />

        <div className="player-info">
          {multiChapter ? (
            <button type="button" className="player-chapter" onClick={() => setSheet("chapters")}>
              Chapter {ci + 1} of {item.chapters.length}
            </button>
          ) : null}
          <h1 className="player-title">{item.title}</h1>
          <div className="player-sub">{multiChapter && chapter ? chapter.title : item.subtitle}</div>
        </div>

        <div className="player-scrub">
          <input
            type="range"
            className="scrubber"
            aria-label="Position"
            min={0}
            max={Math.floor(spanLen)}
            step={1}
            value={Math.min(Math.floor(within), Math.floor(spanLen))}
            style={{ "--pct": `${(within / spanLen) * 100}%` } as React.CSSProperties}
            onChange={(e) => setScrub(span.start + Number(e.target.value))}
            onPointerUp={commitScrub}
            onKeyUp={commitScrub}
          />
          <div className="player-times">
            <span>{clock(within)}</span>
            <span>{item.durationSec ? `${pct}% · ${timeLeft(item.durationSec, pos)}` : ""}</span>
            <span>-{clock(spanLen - within)}</span>
          </div>
        </div>

        <div className="player-controls">
          <button
            type="button"
            className="icon-btn dim"
            onClick={() => p.chapterStep(-1)}
            aria-label={multiChapter ? "Previous chapter" : "Back 30 seconds"}
          >
            <PrevChapterIcon />
          </button>
          <button type="button" className="skip-btn" onClick={() => p.skipBy(-p.skip.back)} aria-label={`Skip back ${p.skip.back} seconds`}>
            <SkipBackIcon size={36} />
            <span>{p.skip.back}</span>
          </button>
          <button
            type="button"
            className="play-btn"
            onClick={p.toggle}
            aria-label={p.playing ? "Pause" : "Play"}
            data-loading={p.loading || undefined}
          >
            {p.playing ? <PauseIcon size={32} /> : <PlayIcon size={32} />}
          </button>
          <button
            type="button"
            className="skip-btn"
            onClick={() => p.skipBy(p.skip.forward)}
            aria-label={`Skip forward ${p.skip.forward} seconds`}
          >
            <SkipForwardIcon size={36} />
            <span>{p.skip.forward}</span>
          </button>
          <button
            type="button"
            className="icon-btn dim"
            onClick={() => p.chapterStep(1)}
            aria-label={multiChapter ? "Next chapter" : "Forward 30 seconds"}
          >
            <NextChapterIcon />
          </button>
        </div>
        {p.error ? <p className="error player-error">{p.error}</p> : null}
      </div>

      <div className="player-tiles">
        <div className="speed-wrap">
          {speedOpen ? (
            <>
              <div className="speed-scrim" onClick={() => setSpeedOpen(false)} aria-hidden="true" />
              <div className="speed-pop" role="group" aria-label="Playback speed">
                <div className="speed-head">
                  <span className="speed-value">{speedText(speedDraft ?? p.speed)}</span>
                  {(speedDraft ?? p.speed) !== 1 ? (
                    <button type="button" className="speed-reset" onClick={() => p.setSpeed(1)}>
                      Reset
                    </button>
                  ) : null}
                </div>
                <div className="speed-row">
                  <button
                    type="button"
                    className="speed-step"
                    aria-label={`Slower by ${SPEED_STEP}`}
                    disabled={p.speed <= MIN_SPEED}
                    onClick={() => p.setSpeed(clampSpeed(p.speed - SPEED_STEP))}
                  >
                    <MinusIcon size={20} />
                  </button>
                  <input
                    type="range"
                    className="scrubber speed-slider"
                    aria-label="Playback speed"
                    min={MIN_SPEED}
                    max={MAX_SPEED}
                    step={0.05}
                    value={speedDraft ?? p.speed}
                    style={{ "--pct": `${(((speedDraft ?? p.speed) - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)) * 100}%` } as React.CSSProperties}
                    onChange={(e) => setSpeedDraft(clampSpeed(Number(e.target.value)))}
                    onPointerUp={() => {
                      if (speedDraft !== null) p.setSpeed(speedDraft);
                      setSpeedDraft(null);
                    }}
                    onKeyUp={() => {
                      if (speedDraft !== null) p.setSpeed(speedDraft);
                      setSpeedDraft(null);
                    }}
                  />
                  <button
                    type="button"
                    className="speed-step"
                    aria-label={`Faster by ${SPEED_STEP}`}
                    disabled={p.speed >= MAX_SPEED}
                    onClick={() => p.setSpeed(clampSpeed(p.speed + SPEED_STEP))}
                  >
                    <PlusIcon size={20} />
                  </button>
                </div>
              </div>
            </>
          ) : null}
          <button type="button" className="tile" onClick={() => setSpeedOpen((o) => !o)} aria-expanded={speedOpen}>
            <strong>{speedText(p.speed)}</strong>
            <span>Speed</span>
          </button>
        </div>
        <button type="button" className="tile" onClick={() => setSheet("sleep")} aria-pressed={p.sleep.mode !== "off"}>
          <MoonIcon size={20} />
          <span>{sleepLabel(p.sleep, Date.now())}</span>
        </button>
        <button type="button" className="tile" onClick={() => setSheet("chapters")} disabled={!multiChapter}>
          <ListIcon size={20} />
          <span>Chapters</span>
        </button>
        <Link href="/up-next" className="tile" onClick={() => setExpanded(false)}>
          <QueueIcon size={20} />
          <span>Up Next{p.queue.length ? ` (${p.queue.length})` : ""}</span>
        </Link>
      </div>

      <Sheet open={sheet === "sleep"} onClose={() => setSheet(null)} title="Sleep timer">
        <SheetItem active={p.sleep.mode === "off"} onClick={choose(() => p.setSleep({ mode: "off" }))}>
          Off
        </SheetItem>
        {SLEEP_MINUTES.map((m) => (
          <SheetItem key={m} onClick={choose(() => p.setSleep({ mode: "timer", endsAt: Date.now() + m * 60_000 }))}>
            {m} minutes
          </SheetItem>
        ))}
        <SheetItem
          active={p.sleep.mode === "chapter"}
          disabled={!(multiChapter && chapter) && !item.durationSec}
          onClick={choose(() =>
            p.setSleep({ mode: "chapter", endSec: multiChapter && chapter ? chapter.endSec : item.durationSec }),
          )}
        >
          End of {multiChapter ? "chapter" : item.type === "book" ? "book" : "episode"}
        </SheetItem>
      </Sheet>

      <Sheet open={sheet === "chapters"} onClose={() => setSheet(null)} title="Chapters">
        <ol className="chapter-list">
          {item.chapters.map((c, i) => (
            <li key={c.index}>
              <button type="button" aria-current={i === ci || undefined} onClick={choose(() => p.seek(c.startSec))}>
                <span className="chapter-num">{i + 1}</span>
                <span className="chapter-title">{c.title}</span>
                <span className="muted small">{duration(c.endSec - c.startSec)}</span>
              </button>
            </li>
          ))}
        </ol>
      </Sheet>

      <Sheet open={sheet === "more"} onClose={() => setSheet(null)} title={item.title}>
        <Link
          href={item.href}
          className="sheet-item"
          onClick={() => {
            setSheet(null);
            setExpanded(false);
          }}
        >
          Go to {item.type === "book" ? "book" : "show"}
        </Link>
        <SheetItem onClick={choose(() => p.markCurrent(true))}>Mark as finished</SheetItem>
        <SheetItem onClick={choose(() => p.markCurrent(false))}>Start from the beginning</SheetItem>
        <SheetItem danger onClick={choose(() => p.stop())}>
          Stop and close player
        </SheetItem>
      </Sheet>
    </div>
  );
}
