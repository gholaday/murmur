"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { episodeLabel, errorText, seasonName, storageKeys, type VideoEpisode } from "@murmur/shared/client";
import { CloseButton, usePanelDismiss, useRoomy } from "../player/side-panel";
import { setManyFinished } from "../progress";
import { getJson, setJson } from "../storage";
import { Chip, Chips } from "../ui";
import { EpisodeRow } from "./tv-show-view";

// ---------- Open or closed, remembered in this browser ----------

let saved: boolean | null | undefined;
const listeners = new Set<() => void>();

function load(): boolean | null {
  if (saved === undefined) {
    const s = getJson<boolean>(storageKeys.videoPanel);
    saved = typeof s === "boolean" ? s : null;
  }
  return saved;
}

function save(open: boolean) {
  saved = open;
  setJson(storageKeys.videoPanel, open);
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/**
 * Whether the video player's Next episodes panel shows on wide screens. Like the audio side
 * panel, it starts open from 1200px and closed narrower, until you open or close it.
 */
export function useNextPanel() {
  const s = useSyncExternalStore(subscribe, load, () => null);
  const roomy = useRoomy();
  const open = s ?? roomy;
  return { open, roomy, toggle: () => save(!open), close: () => save(false) };
}

// ---------- The panel ----------

/**
 * The rest of the show beside the video, in the shell's panel slot: a tab per season when they
 * span more than one, then the show page's episode rows. From 1200px it pushes the page;
 * narrower it floats over it, and Escape or a click outside closes it.
 */
export function NextPanel({ episodes, replace }: { episodes: VideoEpisode[]; replace: boolean }) {
  const panel = useNextPanel();
  const ref = useRef<HTMLElement>(null);
  usePanelDismiss(ref, panel.open && !panel.roomy, panel.close);
  const seasons = [...new Set(episodes.map((e) => e.season))];
  const [season, setSeason] = useState(seasons[0]);
  /** Marked here: the player's list is what the page had when it opened. */
  const [marked, setMarked] = useState<Record<string, boolean>>({});

  const mark = async (e: VideoEpisode, done: boolean) => {
    try {
      await setManyFinished([{ itemType: "video", itemId: e.id, durationSec: e.durationSec }], done);
      setMarked((m) => ({ ...m, [e.id]: done }));
      const what = episodeLabel(e.season, e.episode);
      toast(done ? `Marked ${what} as watched` : `Marked ${what} as not watched`);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const shown = episodes
    .filter((e) => seasons.length < 2 || e.season === season)
    .map((e) =>
      marked[e.id] === undefined ? e : { ...e, progress: marked[e.id] ? { positionSec: e.durationSec, finished: true, updatedAt: Date.now() } : null },
    );

  return (
    <aside ref={ref} className="shell-panel side-panel" aria-label="Next episodes">
      <div className="side-panel-head">
        <div className="side-panel-title">
          <div className="sheet-title">Next episodes</div>
        </div>
        <CloseButton onClose={panel.close} />
      </div>
      {seasons.length > 1 ? (
        <div className="side-panel-head side-panel-tabs">
          <Chips kind="tabs" label="Seasons">
            {seasons.map((s) => (
              <Chip key={s} selected={s === season} onClick={() => setSeason(s)}>
                {seasonName(s)}
              </Chip>
            ))}
          </Chips>
        </div>
      ) : null}
      <div className="side-panel-scroll">
        <div key={season} className="view-fade">
          {shown.map((e) => (
            <EpisodeRow key={e.id} e={e} onMark={mark} replace={replace} />
          ))}
        </div>
      </div>
    </aside>
  );
}
