"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Cover } from "../cover";
import {
  chapterAt,
  clampSpeed,
  clock,
  duration,
  MAX_SPEED,
  MIN_SPEED,
  SLEEP_MINUTES,
  sleepLabel,
  SPEED_STEP,
  speedText,
  timeLeft,
} from "@murmur/shared/client";
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
  VolumeIcon,
} from "../icons";
import { Sheet, SheetItem } from "../sheet";
import { AD_MODES, adBreak, adModeFor, adPrefsStore, setShowMode, useAdPrefs } from "./ad-prefs";
import { usePlayer, usePosition } from "./engine";
import { effectiveVolume, useVolume, volumeStore } from "./volume";

/** Matches the `sink` animation in globals.css. */
const CLOSE_MS = 200;

export function FullPlayer() {
  const p = usePlayer();
  const [sheet, setSheet] = useState<null | "sleep" | "chapters" | "more" | "ads">(null);
  const adPrefs = useAdPrefs();
  const volume = useVolume();
  const [speedOpen, setSpeedOpen] = useState(false);
  /** Slider value while dragging; saved once you let go. */
  const [speedDraft, setSpeedDraft] = useState<number | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const { item, expanded, setExpanded } = p;
  const speedOpenRef = useRef(false);
  speedOpenRef.current = speedOpen;
  // Minimizing plays the opening animation in reverse before the player unmounts.
  const [closing, setClosing] = useState(false);
  const [wasExpanded, setWasExpanded] = useState(expanded);
  if (wasExpanded !== expanded) {
    setWasExpanded(expanded);
    setClosing(!expanded);
  }
  // Minimized, the player draws nothing, so it needn't redraw on every tick.
  const position = usePosition(expanded || closing);
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => setClosing(false), CLOSE_MS);
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
  // With chapters the bar spans the current chapter, like Pocket Casts; otherwise the whole item.
  const span = chapter && multiChapter ? { start: chapter.startSec, end: chapter.endSec } : { start: 0, end: item.durationSec || 0 };
  const within = Math.max(0, pos - span.start);
  const spanLen = Math.max(1, span.end - span.start);
  const commitScrub = () => {
    if (scrub !== null) p.seek(scrub);
    setScrub(null);
  };
  const choose = (fn: () => void) => () => {
    fn();
    setSheet(null);
  };
  // Ads only ever exist for episodes; books keep the Chapters tile.
  const showAds = item.type === "episode" && p.adsEnabled;
  // Songs: previous and next instead of skips and chapters, no speed, no position kept.
  const song = item.type === "track";
  const adMode = adModeFor(adPrefs, item.podcastId);
  const marks = showAds && adMode !== "off" ? p.ads : [];
  const adIndex = marks.findIndex((a) => pos >= a.startSec && pos < a.endSec);
  const inAd = adIndex >= 0 ? adBreak(marks, adIndex) : null;
  const pct = (sec: number) => `${(Math.min(Math.max(sec - span.start, 0), spanLen) / spanLen) * 100}%`;

  return (
    <div
      className={`player${closing ? " closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Player"
      style={{ "--tint": item.color ?? "#3b4a6e" } as React.CSSProperties}
    >
      <div className="player-top">
        <button type="button" className="icon-btn" onClick={() => setExpanded(false)} aria-label="Close player">
          <DownIcon />
        </button>
        <div className="player-from">Playing from {song ? (p.musicContext?.title ?? "Music") : item.type === "book" ? "Books" : "Podcasts"}</div>
        <button type="button" className="icon-btn" onClick={() => setSheet("more")} aria-label="More options">
          <MoreIcon />
        </button>
      </div>

      <div className="player-main">
        {/* Skip ad sits on the cover so it never moves the controls. */}
        <div className="player-cover-wrap">
          <Cover src={item.coverUrlLarge} color={item.color} title={item.title} subtitle={item.subtitle} className="player-cover" large />
          {inAd ? (
            <button type="button" className="skip-ad" onClick={() => p.seek(inAd.endSec)}>
              Skip ad
              <NextChapterIcon size={16} />
            </button>
          ) : null}
        </div>

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
          <div className="scrub-wrap">
            {marks.length ? (
              <div className="scrub-track" aria-hidden="true">
                <div className="scrub-played" style={{ width: pct(pos) }} />
                {marks.map((a) => (
                  <div
                    key={a.startSec}
                    className="scrub-ad"
                    style={
                      {
                        left: pct(a.startSec),
                        width: `calc(${pct(a.endSec)} - ${pct(a.startSec)})`,
                        "--heard": `${Math.min(100, Math.max(0, ((pos - a.startSec) / (a.endSec - a.startSec)) * 100))}%`,
                      } as React.CSSProperties
                    }
                  />
                ))}
              </div>
            ) : null}
          <input
            type="range"
            className={`scrubber${marks.length ? " over-track" : ""}`}
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
          </div>
          <div className="player-times">
            <span>{clock(within)}</span>
            <span>{item.durationSec && !song ? timeLeft(item.durationSec, pos) : ""}</span>
            <span>-{clock(spanLen - within)}</span>
          </div>
        </div>

        <div className="player-controls">
          {song ? (
            <button type="button" className="skip-btn" onClick={() => p.trackStep(-1)} aria-label="Previous song">
              <PrevChapterIcon size={32} />
            </button>
          ) : (
            <>
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
            </>
          )}
          <button
            type="button"
            className="play-btn"
            onClick={p.toggle}
            aria-label={p.playing ? "Pause" : "Play"}
            data-loading={p.loading || undefined}
          >
            {p.playing ? <PauseIcon size={32} /> : <PlayIcon size={32} />}
          </button>
          {song ? (
            <button type="button" className="skip-btn" onClick={() => p.trackStep(1)} aria-label="Next song">
              <NextChapterIcon size={32} />
            </button>
          ) : (
            <>
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
            </>
          )}
        </div>
        <div className="player-volume">
          <button
            type="button"
            className="icon-btn dim"
            aria-label={volume.muted ? "Unmute" : "Mute"}
            onClick={() =>
              volumeStore.set(
                // Unmuting from zero would stay silent, so it comes back at half.
                volume.muted || volume.level === 0 ? { level: volume.level || 0.5, muted: false } : { ...volume, muted: true },
              )
            }
          >
            <VolumeIcon level={effectiveVolume(volume)} size={20} />
          </button>
          <input
            type="range"
            className="scrubber"
            aria-label="Volume"
            min={0}
            max={1}
            step={0.01}
            value={effectiveVolume(volume)}
            style={{ "--pct": `${effectiveVolume(volume) * 100}%` } as React.CSSProperties}
            onChange={(e) => volumeStore.set({ level: Number(e.target.value), muted: false })}
          />
        </div>
        {p.error ? <p className="error player-error">{p.error}</p> : null}
      </div>

      <div className="player-tiles">
        <div className="speed-wrap" hidden={song}>
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
        {showAds ? (
          <button type="button" className="tile" onClick={() => setSheet("ads")}>
            <strong>{AD_MODES.find((m) => m.id === adMode)?.short}</strong>
            <span>Ads</span>
          </button>
        ) : song ? null : (
          <button type="button" className="tile" onClick={() => setSheet("chapters")} disabled={!multiChapter}>
            <ListIcon size={20} />
            <span>Chapters</span>
          </button>
        )}
        <Link href="/listening" className="tile" onClick={() => setExpanded(false)}>
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
          End of {multiChapter ? "chapter" : song ? "song" : item.type === "book" ? "book" : "episode"}
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
            <div className="sheet-group-title">{item.subtitle ?? "This show"}</div>
            <div className="chips" role="radiogroup" aria-label="Ads for this show">
              {[{ id: null, label: "Default" }, ...AD_MODES].map((m) => {
                const current = adPrefs.shows[item.podcastId!] ?? null;
                return (
                  <button
                    key={m.id ?? "default"}
                    type="button"
                    role="radio"
                    className="chip"
                    aria-checked={current === m.id}
                    aria-pressed={current === m.id}
                    onClick={() => adPrefsStore.set(setShowMode(adPrefs, item.podcastId!, m.id))}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
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
          Go to {song ? "album" : item.type === "book" ? "book" : "show"}
        </Link>
        {song ? null : (
          <>
            <SheetItem onClick={choose(() => p.markCurrent(true))}>Mark as finished</SheetItem>
            <SheetItem onClick={choose(() => p.markCurrent(false))}>Start from the beginning</SheetItem>
          </>
        )}
        <SheetItem danger onClick={choose(() => p.stop())}>
          Stop and close player
        </SheetItem>
      </Sheet>
    </div>
  );
}
