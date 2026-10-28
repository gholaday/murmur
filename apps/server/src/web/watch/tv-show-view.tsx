"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  apiPaths,
  duration,
  episodeLabel,
  errorText,
  percentDone,
  plural,
  type ShowDetail,
  timeLeft,
  type VideoEpisode,
  type VideoQuality,
} from "@murmur/shared/client";
import { CheckIcon, MoreIcon, PlayedIcon, PlayIcon } from "../icons";
import { setManyFinished } from "../progress";
import { Sheet, SheetItem } from "../sheet";
import { BackButton, Chip, Chips } from "../ui";
import { playHref, Poster, Still } from "./cards";
import { WatchMatchDialog } from "./match-sheet";
import { QualityPick } from "./quality-pick";

const seasonName = (season: number) => (season === 0 ? "Specials" : `Season ${season}`);

/** An episode row: still with how far you are, title, "S1 E2" with the time, and a watched toggle. */
function EpisodeRow({ e, onMark }: { e: VideoEpisode; onMark: (e: VideoEpisode, done: boolean) => void }) {
  const finished = !!e.progress?.finished;
  const position = e.progress && !finished ? e.progress.positionSec : 0;
  return (
    <div className={`episode-row ${finished ? "watched" : ""}`}>
      <Link className="episode-row-main" href={playHref("episode", e.id)}>
        <div className="card-cover episode-still">
          <Still videoId={e.id} hash={e.stillHash} title={e.title} />
          {position > 0 ? (
            <div className="bar still-bar">
              <div style={{ width: `${percentDone(position, e.durationSec)}%` }} />
            </div>
          ) : null}
        </div>
        <div className="list-row-main">
          <span className="list-row-title">{e.title}</span>
          <span className="list-row-sub">
            {episodeLabel(e.season, e.episode)}, {position > 0 ? timeLeft(e.durationSec, position) : duration(e.durationSec)}
          </span>
        </div>
      </Link>
      <button
        type="button"
        className="icon-btn"
        aria-label={finished ? "Mark as not watched" : "Mark as watched"}
        aria-pressed={finished}
        onClick={() => onMark(e, !finished)}
      >
        <PlayedIcon played={finished} />
      </button>
    </div>
  );
}

/** A show: poster, Resume on the next episode, a chip per season and its episodes. */
export function TvShowView({ show, canMatch }: { show: ShowDetail; canMatch: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [menu, setMenu] = useState(false);
  const [matching, setMatching] = useState(false);
  /** A converted-video quality picked for this viewing; null means your setting. */
  const [quality, setQuality] = useState<VideoQuality | null>(null);
  const all = show.seasonList.flatMap((s) => s.episodes);
  const upNext = all.find((e) => e.id === show.upNextId) ?? null;
  // Opens on the season you're in, or the one asked for.
  const asked = Number(params.get("season"));
  const [season, setSeason] = useState(
    show.seasonList.some((s) => s.season === asked) ? asked : (upNext?.season ?? show.seasonList[0]?.season ?? 1),
  );
  const episodes = show.seasonList.find((s) => s.season === season)?.episodes ?? [];
  const seasonDone = episodes.length > 0 && episodes.every((e) => e.progress?.finished);
  const posterSrc = show.posterHash ? apiPaths.showArtUrl(show.id, "poster", show.posterHash) : null;
  const backdropSrc = show.backdropHash ? apiPaths.showArtUrl(show.id, "backdrop", show.backdropHash) : null;
  const firstStill = all.find((e) => e.stillHash);
  // The blurred colour behind the header: the backdrop, else the poster, else a frame from an episode.
  const heroArt = backdropSrc ?? posterSrc ?? (firstStill ? apiPaths.videoStillUrl(firstStill.id, firstStill.stillHash!, "small") : null);
  const pills = [show.year, plural(show.seasons, "season"), plural(show.episodes, "episode")].filter(Boolean) as string[];
  const upNextPosition = upNext?.progress && !upNext.progress.finished ? upNext.progress.positionSec : 0;

  const mark = async (list: VideoEpisode[], done: boolean, what: string) => {
    try {
      await setManyFinished(
        list.map((e) => ({ itemType: "video" as const, itemId: e.id, durationSec: e.durationSec })),
        done,
      );
      toast(done ? `Marked ${what} as watched` : `Marked ${what} as not watched`);
      router.refresh();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <>
      <div
        className="hero"
        style={
          {
            "--tint": show.color ?? "#2a3550",
            "--art": heroArt ? `url("${heroArt}")` : "none",
          } as React.CSSProperties
        }
      >
        <div className="hero-bar">
          <BackButton fallback="/watch" />
          {canMatch ? (
            <button type="button" className="icon-btn" aria-label="More options" onClick={() => setMenu(true)}>
              <MoreIcon />
            </button>
          ) : null}
        </div>
        <div className="show-hero">
          <Poster kind="show" id={show.id} hash={show.posterHash} color={show.color} title={show.title} sub={show.year} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 4, minWidth: 0 }}>
            <h1 className="show-title">{show.title}</h1>
            <div className="pills">
              {pills.map((p) => (
                <span key={p} className="pill">
                  {p}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="actions">
        {upNext ? (
          <>
            <Link className="btn btn-primary btn-big" href={playHref("episode", upNext.id, undefined, quality)}>
              <PlayIcon size={22} />
              <span>
                {upNextPosition > 0 ? "Resume" : "Play"} {episodeLabel(upNext.season, upNext.episode)}
              </span>
            </Link>
            <QualityPick file={upNext.file} value={quality} onChange={setQuality} />
          </>
        ) : (
          <button type="button" className="btn btn-big" disabled>
            <CheckIcon size={20} />
            <span>All watched</span>
          </button>
        )}
        <button
          type="button"
          className="btn-round"
          aria-label={seasonDone ? `Mark ${seasonName(season)} as not watched` : `Mark ${seasonName(season)} as watched`}
          aria-pressed={seasonDone}
          onClick={() => mark(episodes, !seasonDone, seasonName(season))}
        >
          <CheckIcon />
        </button>
      </div>

      {show.description ? <p className="description clamped">{show.description}</p> : null}

      <section className="section">
        {show.seasonList.length > 1 ? (
          <Chips kind="tabs" label="Seasons">
            {show.seasonList.map((s) => (
              <Chip key={s.season} selected={s.season === season} onClick={() => setSeason(s.season)}>
                {seasonName(s.season)}
              </Chip>
            ))}
          </Chips>
        ) : (
          <h2 className="section-title">{seasonName(season)}</h2>
        )}
        <div>
          {episodes.map((e) => (
            <EpisodeRow key={e.id} e={e} onMark={(ep, done) => mark([ep], done, episodeLabel(ep.season, ep.episode))} />
          ))}
        </div>
      </section>

      <Sheet open={menu} onClose={() => setMenu(false)} title={show.title}>
        <SheetItem
          onClick={() => {
            setMenu(false);
            setMatching(true);
          }}
        >
          Match…
        </SheetItem>
      </Sheet>
      {matching ? (
        <WatchMatchDialog kind="show" id={show.id} title={show.title} year={show.year} tmdbId={show.tmdbId} onClose={() => setMatching(false)} />
      ) : null}
    </>
  );
}
