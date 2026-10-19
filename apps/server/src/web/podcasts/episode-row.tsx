"use client";

import { useState } from "react";
import { toast } from "sonner";
import { apiPaths, duration, type EpisodeWithShow, shortDate, timeLeft } from "@murmur/shared";
import { api } from "../api";
import { Cover } from "../cover";
import { CheckIcon, PauseIcon, PlayIcon } from "../icons";
import { episodeToPlayable, usePlayer, usePosition } from "../player/engine";
import { setFinished } from "../progress";

/** Progress ring drawn around the play button. */
function Ring({ pct }: { pct: number }) {
  const r = 21;
  const c = 2 * Math.PI * r;
  return (
    <svg className="progress-ring" viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r={r} strokeDasharray={`${(pct / 100) * c} ${c}`} />
    </svg>
  );
}

export function EpisodeRow({
  episode,
  showThumb = false,
  onChanged,
}: {
  episode: EpisodeWithShow;
  showThumb?: boolean;
  /** Called after played/archived changes so the list can refresh. */
  onChanged?: () => void;
}) {
  const player = usePlayer();
  const live = usePosition();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const current = player.isCurrent("episode", episode.id);
  const played = !!episode.progress?.finished && !current;
  const dur = (current ? player.item?.durationSec : null) || episode.durationSec || 0;
  const position = current ? live : episode.progress && !episode.progress.finished ? episode.progress.positionSec : 0;
  const pct = dur ? Math.min(100, (position / dur) * 100) : 0;
  const queued = player.queue.some((q) => q.itemType === "episode" && q.itemId === episode.id);

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

  return (
    <div className={`episode ${played ? "played" : ""} ${open ? "episode-open" : ""}`}>
      {showThumb ? (
        <Cover
          className="thumb"
          src={episode.podcastCoverHash ? apiPaths.podcastCoverUrl(episode.podcastId, episode.podcastCoverHash, 200) : null}
          color={episode.podcastCoverColor}
          title={episode.podcastTitle}
        />
      ) : null}
      <div className="episode-main">
        <button type="button" style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 3 }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="episode-meta">
            {showThumb ? <span className="episode-show">{episode.podcastTitle}</span> : null}
            <span>{shortDate(episode.publishedAt)}</span>
            <span className={`episode-time ${current ? "playing" : ""}`}>{current ? `Playing, ${time}` : time}</span>
          </span>
          <span className="episode-title">{episode.title}</span>
          {episode.description ? <span className="episode-desc">{episode.description}</span> : null}
        </button>
        {open ? (
          <div className="episode-actions">
            <button
              type="button"
              className="btn"
              disabled={busy || current}
              onClick={() => void run(() => player.queueAdd({ itemType: "episode", itemId: episode.id }, "next"), "Plays next")}
            >
              Play next
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || current || queued}
              onClick={() => void run(() => player.queueAdd({ itemType: "episode", itemId: episode.id }, "last"), "Added to Up Next")}
            >
              {queued ? "In Up Next" : "Add to Up Next"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const finished = current ? !played : !episode.progress?.finished;
                  if (current) player.markCurrent(finished);
                  // Saved here too (not only by the player) so the refresh after this already sees it.
                  await setFinished("episode", episode.id, dur, finished);
                }, episode.progress?.finished ? "Marked as unplayed" : "Marked as played")
              }
            >
              {episode.progress?.finished ? "Mark unplayed" : "Mark played"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api(`/api/episodes/${episode.id}/archive`, { method: "PUT", body: { archived: !episode.archived } });
                  await player.refreshQueue();
                }, episode.archived ? "Unarchived" : "Archived")
              }
            >
              {episode.archived ? "Unarchive" : "Archive"}
            </button>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className={`ring-btn ${played ? "played" : ""}`}
        onClick={onPlay}
        aria-label={current && player.playing ? "Pause" : played ? "Play again" : "Play"}
        data-loading={(current && player.loading) || undefined}
      >
        {pct > 0 && !played ? <Ring pct={pct} /> : null}
        {current && player.playing ? <PauseIcon size={18} /> : played ? <CheckIcon size={18} /> : <PlayIcon size={16} />}
      </button>
    </div>
  );
}
