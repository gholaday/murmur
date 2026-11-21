"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "../toast";
import { apiPaths, type BookmarkDto, duration, type EpisodeWithShow, errorText, pastStart, shortDate, timeLeft } from "@murmur/shared/client";
import { api } from "../api";
import { BookmarkRows } from "../bookmark-rows";
import { useBookmarks } from "../bookmarks";
import { Cover } from "../cover";
import { BookmarkIcon, EnhancedIcon, PauseIcon, PlayedIcon, PlayIcon, QueueAddIcon } from "../icons";
import { episodeToPlayable, usePlayerControls, usePlayerSelect, usePosition } from "../player/engine";
import { setFinished } from "../progress";

/** An episode's play state, for its play pill: played, where it's up to, and what a tap does. */
export function useEpisodePlay(episode: EpisodeWithShow) {
  const player = usePlayerControls();
  const current = usePlayerSelect((s) => s.isCurrent("episode", episode.id));
  const playing = usePlayerSelect((s) => current && s.playing);
  const loading = usePlayerSelect((s) => current && s.loading);
  const liveDur = usePlayerSelect((s) => (current ? s.item?.durationSec : null));
  const live = usePosition(current);

  const played = !!episode.progress?.finished && !current;
  const dur = liveDur || episode.durationSec || 0;
  const position = current ? live : episode.progress && !episode.progress.finished ? episode.progress.positionSec : 0;
  const time = played ? "Played" : pastStart(position) && dur ? timeLeft(dur, position) : duration(dur);

  // Starting an episode opens the full player; pausing and resuming leave it as it is.
  const onPlay = () => {
    if (current) return player.toggle();
    player.play(episodeToPlayable(episode), played ? 0 : undefined);
    player.setExpanded(true);
  };
  return { current, playing, loading, played, dur, position, time, onPlay };
}

/** The accent play pill with the time, then the progress bar once it's started. */
function EpisodePlayPill({ play }: { play: ReturnType<typeof useEpisodePlay> }) {
  const { playing, loading, played, dur, position, time, onPlay } = play;
  const pct = dur ? Math.min(100, (position / dur) * 100) : 0;
  return (
    <>
      <button
        type="button"
        className="episode-play"
        onClick={onPlay}
        aria-label={playing ? "Pause" : played ? "Play again" : "Play"}
        data-loading={loading || undefined}
      >
        {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
        <span>{time}</span>
      </button>
      {pastStart(position) && !played ? (
        <span className="episode-bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      ) : null}
    </>
  );
}

export function EpisodeRow({
  episode,
  showThumb = false,
  newCount = 0,
  firstBookmarks,
  onChanged,
}: {
  episode: EpisodeWithShow;
  showThumb?: boolean;
  /** The server's copy, on the podcast's page, so badges don't pop in. */
  firstBookmarks?: BookmarkDto[];
  /** When this row stands for a show's new episodes, how many there are; links to the show. */
  newCount?: number;
  /** Called after played changes so the list can refresh. */
  onChanged?: () => void;
}) {
  const player = usePlayerControls();
  const play = useEpisodePlay(episode);
  const bookmarks = useBookmarks("episode", episode.id, firstBookmarks);
  const [open, setOpen] = useState(false);
  // Lists carry only the start of long notes; the rest loads when the row is expanded.
  const [fullNotes, setFullNotes] = useState<string | null>(null);

  const toggleNotes = () => {
    setOpen((o) => !o);
    if (!open && episode.descriptionCut && fullNotes === null) {
      api<EpisodeWithShow>(apiPaths.episode(episode.id))
        .then((e) => setFullNotes(e.description ?? ""))
        .catch(() => {
          // The excerpt stays; nothing else to do.
        });
    }
  };
  const notes = fullNotes ?? episode.description;

  const showHref = `/podcasts/${episode.podcastId}`;

  return (
    <div className={`episode ${play.played ? "played" : ""} ${open ? "episode-open" : ""}`}>
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
            {episode.adsChecked ? (
              <span className="ads-checked" data-tip="Checked for ads and chapters" aria-label="Checked for ads and chapters">
                <EnhancedIcon size={14} />
              </span>
            ) : null}
            {bookmarks.length ? (
              <span className="ads-checked" data-tip="Has bookmarks" aria-label="Has bookmarks">
                <BookmarkIcon size={14} />
              </span>
            ) : null}
          </span>
          {/* The title and description expand the notes in place. */}
          <button type="button" className="episode-text" onClick={toggleNotes} aria-expanded={open}>
            <span className="episode-title">{episode.title}</span>
            {notes ? <span className="episode-desc">{notes}</span> : null}
          </button>
          {open && bookmarks.length ? (
            <div className="episode-bookmarks">
              <div className="eyebrow">Bookmarks</div>
              <BookmarkRows bookmarks={bookmarks} onJump={(b) => void player.jumpTo({ itemType: "episode", itemId: episode.id }, b.positionSec)} />
            </div>
          ) : null}
        </div>
        <EpisodeActions episode={episode} play={play} onChanged={onChanged} />
      </div>
    </div>
  );
}

/** An episode's buttons: the play pill, then queue and played. Rows and Continue listening cards share them. */
export function EpisodeActions({
  episode,
  play,
  onChanged,
}: {
  episode: EpisodeWithShow;
  play: ReturnType<typeof useEpisodePlay>;
  /** Called after played changes so the list can refresh. */
  onChanged?: () => void;
}) {
  const player = usePlayerControls();
  const { current, played, dur } = play;
  const queued = usePlayerSelect((s) => s.isWaiting({ itemType: "episode", itemId: episode.id }));
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
      onChanged?.();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleQueue = () =>
    queued
      ? run(async () => player.removeWaiting({ itemType: "episode", itemId: episode.id }), "Removed from queue")
      : run(() => player.addToUpNext({ itemType: "episode", itemId: episode.id }, "last"), "Added to queue");

  const togglePlayed = () =>
    run(async () => {
      const finished = current ? !played : !episode.progress?.finished;
      // The player saves the one it has loaded; the refresh after this waits for either save.
      if (current) await player.markCurrent(finished);
      else await setFinished("episode", episode.id, dur, finished);
    }, episode.progress?.finished ? "Marked as unplayed" : "Marked as played");

  return (
    <div className="episode-actions">
      <EpisodePlayPill play={play} />
      <button
        type="button"
        className="episode-icon"
        aria-label={queued ? "Remove from queue" : "Add to queue"}
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
  );
}
