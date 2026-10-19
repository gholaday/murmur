"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { apiPaths, duration, type EpisodeWithShow, shortDate, timeLeft } from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { PauseIcon, PlayedIcon, PlayIcon, PlayNextIcon, QueueAddIcon } from "../icons";
import { episodeToPlayable, usePlayer, usePosition } from "../player/engine";
import { setFinished } from "../progress";

export function EpisodeRow({
  episode,
  showThumb = false,
  newCount = 0,
  onChanged,
}: {
  episode: EpisodeWithShow;
  showThumb?: boolean;
  /** When this row stands for a show's new episodes, how many there are; links to the show. */
  newCount?: number;
  /** Called after played changes so the list can refresh. */
  onChanged?: () => void;
}) {
  const player = usePlayer();
  const current = player.isCurrent("episode", episode.id);
  const live = usePosition(current);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Lists carry only the start of long notes; the rest loads when the row is expanded.
  const [fullNotes, setFullNotes] = useState<string | null>(null);

  const toggleNotes = () => {
    setOpen((o) => !o);
    if (!open && episode.descriptionCut && fullNotes === null) {
      api<EpisodeWithShow>(`/api/episodes/${episode.id}`)
        .then((e) => setFullNotes(e.description ?? ""))
        .catch(() => {
          // The excerpt stays; nothing else to do.
        });
    }
  };
  const notes = fullNotes ?? episode.description;

  const played = !!episode.progress?.finished && !current;
  const dur = (current ? player.item?.durationSec : null) || episode.durationSec || 0;
  const position = current ? live : episode.progress && !episode.progress.finished ? episode.progress.positionSec : 0;
  const pct = dur ? Math.min(100, (position / dur) * 100) : 0;
  const queued = player.queue.some((q) => q.itemType === "episode" && q.itemId === episode.id);
  const pausing = current && player.playing;
  const showHref = `/podcasts/${episode.podcastId}`;

  const time = played ? "Played" : position > 5 && dur ? timeLeft(dur, position) : duration(dur);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const onPlay = () => {
    if (current) return player.toggle();
    player.play(episodeToPlayable(episode), played ? 0 : undefined);
  };

  const toggleQueue = () =>
    queued
      ? run(
          () =>
            player.queueReplace(
              player.queue
                .filter((q) => !(q.itemType === "episode" && q.itemId === episode.id))
                .map((q) => ({ itemType: q.itemType, itemId: q.itemId })),
            ),
          "Removed from Up Next",
        )
      : run(() => player.queueAdd({ itemType: "episode", itemId: episode.id }, "last"), "Added to Up Next");

  const togglePlayed = () =>
    run(async () => {
      const finished = current ? !played : !episode.progress?.finished;
      if (current) player.markCurrent(finished);
      // Saved here too (not only by the player) so the refresh after this already sees it.
      await setFinished("episode", episode.id, dur, finished);
    }, episode.progress?.finished ? "Marked as unplayed" : "Marked as played");

  return (
    <div className={`episode ${played ? "played" : ""} ${open ? "episode-open" : ""}`}>
      {showThumb ? (
        <Link href={showHref} className="episode-thumb" aria-label={episode.podcastTitle} tabIndex={-1}>
          <Cover
            className="thumb"
            src={episode.podcastCoverHash ? apiPaths.podcastCoverUrl(episode.podcastId, episode.podcastCoverHash, 200) : null}
            color={episode.podcastCoverColor}
            title={episode.podcastTitle}
          />
        </Link>
      ) : null}
      <div className="episode-main">
        {newCount > 1 ? (
          <Link href={showHref} className="episode-more">
            {newCount} new
          </Link>
        ) : null}
        <div className="episode-info">
          <span className="episode-meta">
            {showThumb ? (
              <Link href={showHref} className="episode-show">
                {episode.podcastTitle}
              </Link>
            ) : null}
            <span className="episode-date">{shortDate(episode.publishedAt)}</span>
          </span>
          {/* The title and description expand the notes in place. */}
          <button type="button" className="episode-text" onClick={toggleNotes} aria-expanded={open}>
            <span className="episode-title">{episode.title}</span>
            {notes ? <span className="episode-desc">{notes}</span> : null}
          </button>
        </div>
        <div className="episode-actions">
          <button
            type="button"
            className="episode-play"
            onClick={onPlay}
            aria-label={pausing ? "Pause" : played ? "Play again" : "Play"}
            data-loading={(current && player.loading) || undefined}
          >
            {pausing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
            <span>{time}</span>
          </button>
          {position > 5 && !played ? (
            <span className="episode-bar" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </span>
          ) : null}
          <button
            type="button"
            className="episode-icon"
            aria-label="Play next"
            disabled={busy || current}
            onClick={() => void run(() => player.queueAdd({ itemType: "episode", itemId: episode.id }, "next"), "Plays next")}
          >
            <PlayNextIcon size={20} />
          </button>
          <button
            type="button"
            className="episode-icon"
            aria-label={queued ? "Remove from Up Next" : "Add to Up Next"}
            aria-pressed={queued}
            disabled={busy || current}
            onClick={() => void toggleQueue()}
          >
            <QueueAddIcon size={20} queued={queued} />
          </button>
          <button
            type="button"
            className="episode-icon"
            aria-label={episode.progress?.finished ? "Mark unplayed" : "Mark played"}
            aria-pressed={!!episode.progress?.finished}
            disabled={busy}
            onClick={() => void togglePlayed()}
          >
            <PlayedIcon size={20} played={!!episode.progress?.finished} />
          </button>
        </div>
      </div>
    </div>
  );
}
