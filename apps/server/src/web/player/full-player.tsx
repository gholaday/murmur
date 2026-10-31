"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Cover } from "../cover";
import { Marquee } from "../marquee";
import { MixerBars } from "../mixer";
import {
  bookFinished,
  chapterAt,
  clampSpeed,
  clock,
  duration,
  MAX_SPEED,
  MIN_SPEED,
  showMarkPlayed,
  SLEEP_MINUTES,
  sleepLabel,
  SPEED_STEP,
  speedText,
  timeLeft,
} from "@murmur/shared/client";
import {
  CheckIcon,
  ChevronIcon,
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
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "../icons";
import { Sheet, SheetItem } from "../sheet";
import { Chip, Chips } from "../ui";
import { UpNextSheet } from "../up-next";
import { AD_MODES, adBreak, adModeFor, adPrefsStore, setShowMode, useAdPrefs } from "./ad-prefs";
import { CastButton } from "../cast/cast-button";
import { useCast } from "../cast/cast";
import { usePlayer, usePosition, useTint } from "./engine";
import { VolumeRow } from "./volume-control";

/** Matches the `sink` animation in globals.css. */
const CLOSE_MS = 200;

/**
 * On a phone, pulling the player's top bar or cover down drags the whole player with your finger;
 * let go far enough or fast enough and it slides away and minimises, otherwise it springs back.
 */
export function usePullToClose(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const [pulled, setPulled] = useState(false);
  const drag = useRef<{ y: number; t: number; dy: number; v: number } | null>(null);
  const settle = (el: HTMLElement, transform: string, easing: string) => {
    el.style.transition = `transform ${CLOSE_MS}ms ${easing}`;
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
      setTimeout(onClose, CLOSE_MS);
    } else settle(el, "", "ease-out");
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || !window.matchMedia("(max-width: 899px)").matches) return;
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
  const [sheet, setSheet] = useState<null | "sleep" | "chapters" | "more" | "ads" | "upnext">(null);
  const adPrefs = useAdPrefs();
  const [speedOpen, setSpeedOpen] = useState(false);
  /** Slider value while dragging; saved once you let go. */
  const [speedDraft, setSpeedDraft] = useState<number | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  /** Where a mouse hovers over a chaptered bar, for the bubble. */
  const [hoverAt, setHoverAt] = useState<number | null>(null);
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
  // Without chapters, an episode's outer buttons step through Up Next and then its show.
  const inList = item.type !== "book";
  // An episode's chapters split the bar into segments over the whole episode; a book's bar spans
  // the current chapter, like Pocket Casts. Without chapters it's the whole item.
  const segmented = item.type === "episode" && multiChapter;
  const span =
    chapter && multiChapter && !segmented ? { start: chapter.startSec, end: chapter.endSec } : { start: 0, end: item.durationSec || 0 };
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
  // Ads only ever exist for episodes. An episode's third tile is Chapters when it has them, else
  // Ads when the show is scanned, else nothing; books always keep Chapters. Ads are also in More.
  const showAds = item.type === "episode" && p.adsEnabled;
  const slot = item.type === "book" || segmented ? "chapters" : showAds ? "ads" : null;
  // Songs: previous and next instead of skips and chapters, no speed, no position kept.
  const song = item.type === "track";
  const waiting = p.upNext.items.length - p.upNext.index - 1;
  const adMode = adModeFor(adPrefs, item.podcastId);
  const marks = showAds && adMode !== "off" ? p.ads : [];
  const adIndex = marks.findIndex((a) => pos >= a.startSec && pos < a.endSec);
  const inAd = adIndex >= 0 ? adBreak(marks, adIndex) : null;
  // An ad that runs to the end leaves nothing to skip to once the time is up.
  const canSkipAd = inAd !== null && !(item.durationSec && item.durationSec - pos < 1);
  const markPlayed = showMarkPlayed(item.type, item.durationSec, pos);
  // Hovering a mouse over the bar lights up that chapter's segment and shows its title in the
  // times row; a drag shows the chapter it would land in the same way. Both in accent.
  const hoverIndex = segmented && scrub === null && hoverAt !== null ? chapterAt(item.chapters, hoverAt) : -1;
  const lineIndex = hoverIndex >= 0 ? hoverIndex : ci;
  const previewing = hoverIndex >= 0 || (segmented && scrub !== null);
  const pct = (sec: number) => `${(Math.min(Math.max(sec - span.start, 0), spanLen) / spanLen) * 100}%`;

  return (
    <div
      ref={pull.ref}
      className={`player${closing ? " closing" : ""}${pull.pulled ? " pulled" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Player"
      style={
        {
          "--tint": tint ?? "#3b4a6e",
          "--art": item.coverUrlLarge ? `url("${item.coverUrlLarge}")` : "none",
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

      <div className="player-main">
        {/* Skip ad and Mark played sit on the cover so they never move the controls. */}
        <div className="player-cover-wrap player-pull" {...pull.handlers}>
          <Cover src={item.coverUrlLarge} color={item.color} title={item.title} subtitle={item.subtitle} className="player-cover" large />
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
        </div>

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
                {marks.map((a) => (
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
                ))}
              </div>
            ) : marks.length ? (
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
                        "--heard": `${Math.min(100, Math.max(0, ((pos - a.startSec) / (a.endSec - a.startSec || 1)) * 100))}%`,
                      } as React.CSSProperties
                    }
                  />
                ))}
              </div>
            ) : null}
          <input
            type="range"
            className={`scrubber${marks.length || segmented ? " over-track" : ""}`}
            aria-label="Position"
            min={0}
            max={Math.floor(spanLen)}
            step={1}
            value={Math.min(Math.floor(within), Math.floor(spanLen))}
            style={{ "--pct": `${(within / spanLen) * 100}%` } as React.CSSProperties}
            onChange={(e) => setScrub(span.start + Number(e.target.value))}
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
              <button
                type="button"
                className={`player-chapter-line${previewing ? " preview" : ""}`}
                onClick={() => setSheet("chapters")}
              >
                {item.chapters[lineIndex]!.title}
              </button>
            ) : (
              <span>{item.durationSec && !song ? timeLeft(item.durationSec, pos) : ""}</span>
            )}
            <span>-{clock(spanLen - within)}</span>
          </div>
        </div>

        <div className="player-controls">
          {song ? (
            <>
              <button
                type="button"
                className={`icon-btn dim${p.repeat !== "off" ? " on" : ""}`}
                onClick={p.cycleRepeat}
                aria-label={p.repeat === "one" ? "Repeat song" : p.repeat === "all" ? "Repeat all" : "Repeat off"}
              >
                {p.repeat === "one" ? <RepeatOneIcon /> : <RepeatIcon />}
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
            aria-label={bookFinished(item.type, item.durationSec, pos, p.playing || p.loading) ? "Play from the start" : p.playing ? "Pause" : "Play"}
            data-loading={p.loading || undefined}
          >
            {p.playing ? <PauseIcon size={32} /> : <PlayIcon size={32} />}
          </button>
          {song ? (
            <>
              <button type="button" className="skip-btn" onClick={() => p.trackStep(1)} aria-label="Next song">
                <NextChapterIcon size={32} />
              </button>
              <button
                type="button"
                className={`icon-btn dim${p.shuffle ? " on" : ""}`}
                onClick={p.toggleShuffle}
                aria-label="Shuffle"
                aria-pressed={p.shuffle}
              >
                <ShuffleIcon />
              </button>
            </>
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
                aria-label={multiChapter ? "Next chapter" : inList ? "Next" : "Forward 30 seconds"}
              >
                <NextChapterIcon />
              </button>
            </>
          )}
        </div>
        <VolumeRow />
        {p.error ? <p className="error player-error">{p.error}</p> : null}
      </div>

      <div className={`player-tiles${item.type === "episode" && !slot ? " fill" : ""}`}>
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
        {slot === "chapters" ? (
          <button type="button" className="tile" onClick={() => setSheet("chapters")} disabled={!multiChapter}>
            <ListIcon size={20} />
            <span>Chapters</span>
          </button>
        ) : slot === "ads" ? (
          <button type="button" className="tile" onClick={() => setSheet("ads")}>
            <strong>{AD_MODES.find((m) => m.id === adMode)?.short}</strong>
            <span>Ads</span>
          </button>
        ) : null}
        <button type="button" className="tile" onClick={() => setSheet("upnext")}>
          <QueueIcon size={20} />
          <span>
            Queue
            {waiting ? <span className="count-pill">{waiting}</span> : null}
          </span>
        </button>
      </div>

      <UpNextSheet open={sheet === "upnext"} onClose={() => setSheet(null)} />

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

      <Sheet open={sheet === "chapters"} onClose={() => setSheet(null)} title="Chapters" count={item.chapters.length}>
        <ol className="chapter-list">
          {item.chapters.map((c, i) => (
            <li key={c.index}>
              <button
                type="button"
                className={i < ci ? "done" : undefined}
                aria-current={i === ci || undefined}
                onClick={choose(() => p.seek(c.startSec))}
              >
                <span className="chapter-num">{i === ci ? <MixerBars playing={p.playing} /> : i + 1}</span>
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
          href={item.href}
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
