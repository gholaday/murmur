"use client";

import { useEffect, useState } from "react";
import { type BookmarkDto, sleepLabel, speedText, thirdTile } from "@murmur/shared/client";
import { BookmarkNoteSheet } from "../bookmark-rows";
import { Cover } from "../cover";
import { DownIcon, ListIcon, MoonIcon, QueueIcon } from "../icons";
import { adModeFor, useAdPrefs } from "./ad-prefs";
import { BookmarkButton } from "./bookmark-button";
import { type Playable, type PlayerApi, usePlayerControls, usePlayerSelect, usePosition, useTint } from "./engine";
import { MiniText } from "./mini-player";
import { Scrubber } from "./scrubber";
import { useSidePanel } from "./side-panel";
import { SleepSheet } from "./sleep";
import { SpeedPop } from "./tiles";
import { Transport } from "./transport";
import { VolumeBar } from "./volume-control";

/**
 * The player docked along the bottom on wide screens, in the shell's bar slot: what's playing on
 * the left (opens the player), the controls and seek bar in the middle, and the rest on the right.
 * The bar itself doesn't follow the playhead; only the small parts that show it do.
 */
export function PlayerBar() {
  const item = usePlayerSelect((p) => p.item);
  const adsEnabled = usePlayerSelect((p) => p.adsEnabled);
  const ads = usePlayerSelect((p) => p.ads);
  const speed = usePlayerSelect((p) => p.speed);
  const { setExpanded } = usePlayerControls();
  const adPrefs = useAdPrefs();
  const tint = useTint(item);
  const [scrub, setScrub] = useState<number | null>(null);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [sleepOpen, setSleepOpen] = useState(false);
  const panel = useSidePanel(item);
  const [editingBookmark, setEditingBookmark] = useState<{ bookmark: BookmarkDto; isNew: boolean } | null>(null);

  useEffect(() => {
    if (!speedOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) setSpeedOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [speedOpen]);

  if (!item) return null;
  const song = item.type === "track";
  const list = thirdTile(item.type, item.chapters.length > 1);
  const marks = item.type === "episode" && adsEnabled && adModeFor(adPrefs, item.podcastId) !== "off" ? ads : [];
  const showing = (tab: "chapters" | "bookmarks" | "upnext") => panel.open && panel.tab === tab;

  return (
    <div
      className="shell-bar pbar"
      role="region"
      aria-label="Player"
      style={
        {
          ...(tint ? { "--tint": tint } : {}),
          ...(item.coverPath ? { "--art": `url("${item.coverPath}")` } : {}),
        } as React.CSSProperties
      }
    >
      <div className="pbar-art" aria-hidden="true" />
      <button type="button" className="pbar-open" onClick={() => setExpanded(true)} aria-label={`Open player: ${item.title}`}>
        <Cover src={item.coverPath} color={item.color} title={item.title} className="pbar-cover" />
        <MiniText item={item} scrub={scrub} />
      </button>

      <BarMiddle item={item} scrub={scrub} onScrub={setScrub} marks={marks} onChapters={() => panel.toggle("chapters")} />

      <div className="pbar-end">
        {song ? null : (
          <div className="speed-wrap">
            {speedOpen ? (
              <>
                <div className="speed-scrim" onClick={() => setSpeedOpen(false)} aria-hidden="true" />
                <SpeedPop />
              </>
            ) : null}
            <button type="button" className="pbar-speed" onClick={() => setSpeedOpen(!speedOpen)} aria-expanded={speedOpen} aria-label={`Speed ${speedText(speed)}`}>
              {speedText(speed)}
            </button>
          </div>
        )}
        <SleepButton onOpen={() => setSleepOpen(true)} />
        {song ? null : <BarBookmark item={item} onEdit={setEditingBookmark} />}
        <VolumeBar />
        <span className="pbar-divider" aria-hidden="true" />
        {/* They open the side panel on their tab, and close it from there. */}
        {list ? (
          <button
            type="button"
            className="icon-btn"
            data-panel-toggle
            onClick={() => panel.toggle(list)}
            aria-pressed={showing(list)}
            aria-label={list === "chapters" ? "Chapters" : "Bookmarks"}
          >
            <ListIcon size={20} />
          </button>
        ) : null}
        <button type="button" className="icon-btn" data-panel-toggle onClick={() => panel.toggle("upnext")} aria-pressed={showing("upnext")} aria-label="Queue">
          <QueueIcon size={20} />
        </button>
        <button type="button" className="icon-btn pbar-expand" onClick={() => setExpanded(true)} aria-label="Open player">
          <DownIcon size={20} />
        </button>
      </div>

      <SleepSheet open={sleepOpen} onClose={() => setSleepOpen(false)} />
      <BookmarkNoteSheet bookmark={editingBookmark?.bookmark ?? null} isNew={editingBookmark?.isNew} onClose={() => setEditingBookmark(null)} />
    </div>
  );
}

// The parts below follow the playhead, so a tick redraws only them.

/** The controls above the seek bar and its times. */
function BarMiddle({
  item,
  scrub,
  onScrub,
  marks,
  onChapters,
}: {
  item: Playable;
  scrub: number | null;
  onScrub: (sec: number | null) => void;
  marks: PlayerApi["ads"];
  onChapters: () => void;
}) {
  const position = usePosition();
  const pos = scrub ?? position;
  return (
    <div className="pbar-mid">
      <Transport item={item} pos={pos} />
      <Scrubber item={item} pos={pos} scrub={scrub} onScrub={onScrub} marks={marks} onChapters={onChapters} />
    </div>
  );
}

function BarBookmark({ item, onEdit }: { item: Playable; onEdit: (edit: { bookmark: BookmarkDto; isNew: boolean }) => void }) {
  const position = usePosition();
  return <BookmarkButton item={item} pos={position} onEdit={onEdit} />;
}

/** The moon, in accent while a timer is set; its label counts down, so it follows the clock only then. */
function SleepButton({ onOpen }: { onOpen: () => void }) {
  const sleep = usePlayerSelect((p) => p.sleep);
  usePosition(sleep.mode === "timer");
  return (
    <button
      type="button"
      className="icon-btn pbar-sleep"
      onClick={onOpen}
      aria-pressed={sleep.mode !== "off"}
      aria-label={sleep.mode === "off" ? "Sleep timer" : `Sleep timer, ${sleepLabel(sleep, Date.now())}`}
    >
      <MoonIcon size={20} />
    </button>
  );
}
