"use client";

import Link from "next/link";
import { apiPaths, episodeLabel, timeLeft, type VideoQuality, type WatchCard } from "@murmur/shared/client";
import { Cover } from "../cover";
import { CheckIcon } from "../icons";

/** Where a movie or show page is. */
export const movieHref = (id: string) => `/watch/movie/${id}`;
export const showHref = (id: string) => `/watch/show/${id}`;
/** The player for a movie (optionally one version of it) or an episode. */
/** The player's page; `v` picks a movie version and `q` a converted-video quality for this viewing. */
export const playHref = (kind: "movie" | "episode", id: string, versionId?: string, quality?: VideoQuality | null) => {
  const params = new URLSearchParams();
  if (versionId) params.set("v", versionId);
  if (quality) params.set("q", quality);
  const query = params.toString();
  return `/watch/play/${kind}/${id}${query ? `?${query}` : ""}`;
};

/** How far through, as a percentage, for progress bars. */
export const percentDone = (positionSec: number, durationSec: number) => (durationSec ? Math.min(100, (positionSec / durationSec) * 100) : 0);

/** A 2:3 poster, or a tinted tile with the title when there's none. */
export function Poster({
  kind,
  id,
  hash,
  color,
  title,
  sub,
  large,
}: {
  kind: "movie" | "show";
  id: string;
  hash: string | null;
  color: string | null;
  title: string;
  sub?: string | null;
  large?: boolean;
}) {
  const src = hash ? (kind === "movie" ? apiPaths.movieArtUrl : apiPaths.showArtUrl)(id, "poster", hash, large ? "large" : "small") : null;
  return <Cover src={src} color={color} title={title} subtitle={sub} className="poster" large={large} />;
}

/** A poster card in a grid: the poster, the title and the year, with the accent check once watched. */
export function PosterCard({
  kind,
  id,
  title,
  year,
  posterHash,
  color,
  watched,
  percent,
}: {
  kind: "movie" | "show";
  id: string;
  title: string;
  year: string | null;
  posterHash: string | null;
  color: string | null;
  watched: boolean;
  /** How far through a movie you are, for its bar. */
  percent?: number;
}) {
  return (
    <div className="card">
      <Link className="card-link" href={kind === "movie" ? movieHref(id) : showHref(id)}>
        <div className="card-cover">
          <Poster kind={kind} id={id} hash={posterHash} color={color} title={title} sub={year} />
          {watched ? (
            <span className="card-done" aria-label="Watched">
              <CheckIcon size={14} />
            </span>
          ) : null}
          {!watched && percent ? (
            <div className="bar poster-bar">
              <div style={{ width: `${percent}%` }} />
            </div>
          ) : null}
        </div>
        <div className="card-title">{title}</div>
        {year ? <div className="card-sub">{year}</div> : null}
      </Link>
    </div>
  );
}

/** A 16:9 still for a movie version or an episode; the poster or a tinted tile stands in without one. */
export function Still({ videoId, hash, title, className = "" }: { videoId: string; hash: string | null; title: string; className?: string }) {
  return <Cover src={hash ? apiPaths.videoStillUrl(videoId, hash, "small") : null} color={null} title={title} className={`still ${className}`} />;
}

/**
 * A card in Continue watching or Next episodes: the still with how far you are, the movie or
 * show, and which episode with the time left on the right. Tapping it plays.
 */
export function StillCard({ card }: { card: WatchCard }) {
  const position = card.progress && !card.progress.finished ? card.progress.positionSec : 0;
  const left = position > 0 ? timeLeft(card.durationSec, position) : null;
  return (
    <Link className="continue-card watch-card" href={playHref(card.kind, card.id)}>
      <div className="card-cover">
        <Still videoId={card.stillId} hash={card.stillHash} title={card.title} />
        {position > 0 ? (
          <div className="bar still-bar">
            <div style={{ width: `${percentDone(position, card.durationSec)}%` }} />
          </div>
        ) : null}
      </div>
      <div className="continue-text">
        <div className="card-title">{card.title}</div>
        <div className="watch-card-sub">
          <span>{card.kind === "episode" ? episodeLabel(card.season ?? 1, card.episode ?? 0) : (left ?? "")}</span>
          {card.kind === "episode" && left ? <span>{left}</span> : null}
        </div>
      </div>
    </Link>
  );
}
