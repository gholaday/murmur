"use client";

import { useState } from "react";
import { clampSpeed, MAX_SPEED, MIN_SPEED, sleepLabel, SPEED_STEP, speedText, thirdTile } from "@murmur/shared/client";
import { BookmarkIcon, ListIcon, MinusIcon, MoonIcon, PlusIcon, QueueIcon } from "../icons";
import { CountPill } from "../ui";
import { type Playable, usePlayerControls, usePlayerSelect } from "./engine";

/** The sheets a tile opens. */
export type TileSheet = "sleep" | "chapters" | "bookmarks" | "upnext";

/**
 * The row of tiles under the full player: Speed (not for songs), Sleep, Chapters or Bookmarks
 * (not for songs), and Queue with how many are waiting. The sleep tile's countdown redraws with
 * its parent, which redraws as the playhead moves.
 */
export function PlayerTiles({
  item,
  speedOpen,
  onSpeedOpen,
  onSheet,
  panelTab,
}: {
  item: Playable;
  /** The speed popover is open; the parent holds it so Escape can close it first. */
  speedOpen: boolean;
  onSpeedOpen: (open: boolean) => void;
  onSheet: (sheet: TileSheet) => void;
  /**
   * On wide screens Chapters, Bookmarks and Queue open the side panel instead of a sheet: the
   * tab it's showing (null while closed), so that tile shows as on.
   */
  panelTab?: TileSheet | null;
}) {
  const speed = usePlayerSelect((s) => s.speed);
  const sleep = usePlayerSelect((s) => s.sleep);
  const upNext = usePlayerSelect((s) => s.upNext);
  const song = item.type === "track";
  const slot = thirdTile(item.type, item.chapters.length > 1);
  const waiting = upNext.items.length - upNext.index - 1;
  // The side panel's toggles: pressed while showing their tab, and not a click outside the floating panel.
  const panel = (tab: TileSheet) => (panelTab === undefined ? {} : { "aria-pressed": panelTab === tab, "data-panel-toggle": true });
  return (
    <div className="player-tiles">
      <div className="speed-wrap" hidden={song}>
        {speedOpen ? (
          <>
            <div className="speed-scrim" onClick={() => onSpeedOpen(false)} aria-hidden="true" />
            <SpeedPop />
          </>
        ) : null}
        <button type="button" className="tile" onClick={() => onSpeedOpen(!speedOpen)} aria-expanded={speedOpen}>
          <strong>{speedText(speed)}</strong>
          <span>Speed</span>
        </button>
      </div>
      <button type="button" className="tile" onClick={() => onSheet("sleep")} aria-pressed={sleep.mode !== "off"}>
        <MoonIcon size={20} />
        <span>{sleepLabel(sleep, Date.now())}</span>
      </button>
      {slot === "chapters" ? (
        <button type="button" className="tile" onClick={() => onSheet("chapters")} {...panel("chapters")}>
          <ListIcon size={20} />
          <span>Chapters</span>
        </button>
      ) : slot === "bookmarks" ? (
        <button type="button" className="tile" onClick={() => onSheet("bookmarks")} {...panel("bookmarks")}>
          <BookmarkIcon size={20} />
          <span>Bookmarks</span>
        </button>
      ) : null}
      <button type="button" className="tile" onClick={() => onSheet("upnext")} {...panel("upnext")}>
        <QueueIcon size={20} />
        <span>
          Queue
          {waiting ? <CountPill count={waiting} /> : null}
        </span>
      </button>
    </div>
  );
}

/** The speed popover: the speed, Reset, and a slider between slower and faster steps. */
export function SpeedPop() {
  const { setSpeed } = usePlayerControls();
  const speed = usePlayerSelect((s) => s.speed);
  /** Slider value while dragging; saved once you let go. */
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? speed;
  const commit = () => {
    if (draft !== null) setSpeed(draft);
    setDraft(null);
  };
  return (
    <div className="speed-pop" role="group" aria-label="Playback speed">
      <div className="speed-head">
        <span className="speed-value">{speedText(shown)}</span>
        {shown !== 1 ? (
          <button type="button" className="speed-reset" onClick={() => setSpeed(1)}>
            Reset
          </button>
        ) : null}
      </div>
      <div className="speed-row">
        <button
          type="button"
          className="speed-step"
          aria-label={`Slower by ${SPEED_STEP}`}
          disabled={speed <= MIN_SPEED}
          onClick={() => setSpeed(clampSpeed(speed - SPEED_STEP))}
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
          value={shown}
          style={{ "--pct": `${((shown - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)) * 100}%` } as React.CSSProperties}
          onChange={(e) => setDraft(clampSpeed(Number(e.target.value)))}
          onPointerUp={commit}
          onKeyUp={commit}
        />
        <button
          type="button"
          className="speed-step"
          aria-label={`Faster by ${SPEED_STEP}`}
          disabled={speed >= MAX_SPEED}
          onClick={() => setSpeed(clampSpeed(speed + SPEED_STEP))}
        >
          <PlusIcon size={20} />
        </button>
      </div>
    </div>
  );
}
