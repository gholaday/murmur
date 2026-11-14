"use client";

import Link from "next/link";
import { toast } from "sonner";
import { bookFinished, clock, showMarkPlayed } from "@murmur/shared/client";
import { useCast } from "../cast/cast";
import { CheckIcon, ChevronIcon, CloseIcon, NextChapterIcon } from "../icons";
import { Sheet, SheetItem } from "../sheet";
import { Chip, Chips } from "../ui";
import { AD_MODES, adBreak, adModeFor, adPrefsStore, setShowMode, useAdPrefs } from "./ad-prefs";
import { type Playable, type PlayerApi, playableHref, usePlayerControls, usePlayerSelect } from "./engine";

// Pieces the phone's full player and the wide screens' Now playing view both show.

/** The ad breaks to mark on the seek bar: an episode's, while the server finds ads and they aren't turned off. */
export function useAdMarks(item: Playable | null): PlayerApi["ads"] {
  const adsEnabled = usePlayerSelect((p) => p.adsEnabled);
  const ads = usePlayerSelect((p) => p.ads);
  const adPrefs = useAdPrefs();
  return item?.type === "episode" && adsEnabled && adModeFor(adPrefs, item.podcastId) !== "off" ? ads : NONE;
}
const NONE: PlayerApi["ads"] = [];

/** "Playing from Books", "Playing on" a Chromecast, or "Finished". */
export function usePlayingFrom(item: Playable | null, pos: number): string {
  const busy = usePlayerSelect((p) => p.playing || p.loading);
  const source = usePlayerSelect((p) => p.upNext.source?.title);
  const castDevice = useCast().device;
  if (!item) return "";
  if (bookFinished(item.type, item.durationSec, pos, busy)) return "Finished";
  if (castDevice) return `Playing on ${castDevice}`;
  return `Playing from ${item.type === "track" ? (source ?? "Music") : item.type === "book" ? "Books" : "Podcasts"}`;
}

/** After a jump to a bookmark: where you were, with Go back and an X to stay. */
export function GoBackCard() {
  const goBackTo = usePlayerSelect((p) => p.goBackTo);
  const { goBack, stayHere } = usePlayerControls();
  if (goBackTo === null) return null;
  return (
    <div className="float-card" role="status">
      <span>You were at {clock(goBackTo)}</span>
      <button type="button" className="more-link" onClick={goBack}>
        Go back
      </button>
      <button type="button" className="icon-btn dim" aria-label="Stay here" onClick={stayHere}>
        <CloseIcon size={18} />
      </button>
    </div>
  );
}

/** Skip ad and Mark played, stacked on the cover's corner so they never move the controls. */
export function CoverPills({ item, pos, marks }: { item: Playable; pos: number; marks: PlayerApi["ads"] }) {
  const { markCurrent, seek } = usePlayerControls();
  const adIndex = marks.findIndex((a) => pos >= a.startSec && pos < a.endSec);
  const inAd = adIndex >= 0 ? adBreak(marks, adIndex) : null;
  // An ad that runs to the end leaves nothing to skip to once the time is up.
  const canSkipAd = inAd !== null && !(item.durationSec && item.durationSec - pos < 1);
  const markPlayed = showMarkPlayed(item.type, item.durationSec, pos);
  if (!canSkipAd && !markPlayed) return null;
  return (
    <div className="cover-pills">
      {markPlayed ? (
        // Marking it played closes the player, as reaching the end does.
        <button
          type="button"
          className="finish-pill"
          onClick={() => {
            void markCurrent(true);
            toast("Marked as played");
          }}
        >
          Mark played
          <CheckIcon size={16} />
        </button>
      ) : null}
      {canSkipAd ? (
        <button type="button" className="skip-ad" onClick={() => seek(inAd.endSec)}>
          Skip ad
          <NextChapterIcon size={16} />
        </button>
      ) : null}
    </div>
  );
}

/** The More sheet (go to it, mark it, start again, ads, stop) and the Ads sheet it leads to. */
export function MoreSheets({ item, sheet, onSheet }: { item: Playable; sheet: "more" | "ads" | null; onSheet: (sheet: "more" | "ads" | null) => void }) {
  const adsEnabled = usePlayerSelect((p) => p.adsEnabled);
  const { markCurrent, setExpanded, stop } = usePlayerControls();
  const adPrefs = useAdPrefs();
  const close = () => onSheet(null);
  const choose = (fn: () => void) => () => {
    fn();
    close();
  };
  // Ads only ever exist for episodes, and their setting lives in More.
  const showAds = item.type === "episode" && adsEnabled;
  const song = item.type === "track";
  const adMode = adModeFor(adPrefs, item.podcastId);
  return (
    <>
      <Sheet open={sheet === "ads"} onClose={close} title="Ads">
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

      <Sheet open={sheet === "more"} onClose={close} title={item.title}>
        <Link
          href={playableHref(item)}
          className="sheet-item"
          onClick={() => {
            close();
            setExpanded(false);
          }}
        >
          Go to {song ? "album" : item.type === "book" ? "book" : "podcast"}
        </Link>
        {song ? null : (
          <>
            <SheetItem
              onClick={choose(() => {
                void markCurrent(true);
                toast(item.type === "book" ? "Marked as finished" : "Marked as played");
              })}
            >
              {item.type === "book" ? "Mark as finished" : "Mark played"}
            </SheetItem>
            <SheetItem onClick={choose(() => markCurrent(false))}>Start from the beginning</SheetItem>
            {showAds ? (
              <SheetItem onClick={() => onSheet("ads")}>
                <span className="sheet-item-grow">Ads</span>
                <span className="setting-value">
                  <span>{AD_MODES.find((m) => m.id === adMode)?.short}</span>
                  <ChevronIcon size={18} />
                </span>
              </SheetItem>
            ) : null}
          </>
        )}
        <SheetItem danger onClick={choose(() => stop())}>
          Stop playback
        </SheetItem>
      </Sheet>
    </>
  );
}
