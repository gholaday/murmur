"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  apiPaths,
  duration,
  errorText,
  fileDetailParts,
  type MovieDetail,
  resolutionLabel,
  timeLeft,
  type VideoFileInfo,
  type VideoQuality,
  versionLabel,
} from "@murmur/shared/client";
import { CheckIcon, ChevronIcon, MoreIcon, PlayIcon } from "../icons";
import { setFinished } from "../progress";
import { Sheet, SheetItem } from "../sheet";
import { BackButton, SettingsCard } from "../ui";
import { playHref, Poster } from "./cards";
import { WatchMatchDialog } from "./match-sheet";
import { QualityPick } from "./quality-pick";

/** Codecs, size and name of a file, for when something won't play. */
export function FileDetails({ file }: { file: VideoFileInfo }) {
  const parts = fileDetailParts(file);
  return (
    <section className="section">
      <h2 className="section-title">File</h2>
      <div className="file-details">
        <span className="file-name">{file.fileName}</span>
        <div className="pills">
          {parts.map((p) => (
            <span key={p} className="pill">
              {p}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/** A movie: poster, Play or Resume, Mark watched, the description, its versions and the file. */
export function MovieView({ movie, canMatch }: { movie: MovieDetail; canMatch: boolean }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [picking, setPicking] = useState(false);
  const [menu, setMenu] = useState(false);
  const [matching, setMatching] = useState(false);
  const [versionId, setVersionId] = useState(movie.versionList[0]!.id);
  /** A converted-video quality picked for this viewing; null means your setting. */
  const [quality, setQuality] = useState<VideoQuality | null>(null);
  const version = movie.versionList.find((v) => v.id === versionId) ?? movie.versionList[0]!;
  const finished = !!movie.progress?.finished;
  const position = movie.progress && !finished ? movie.progress.positionSec : 0;
  const started = position > 5;
  const posterSrc = movie.posterHash ? apiPaths.movieArtUrl(movie.id, "poster", movie.posterHash) : null;
  const backdropSrc = movie.backdropHash ? apiPaths.movieArtUrl(movie.id, "backdrop", movie.backdropHash) : null;
  // The blurred colour behind the header: the backdrop, else the poster, else a frame from the film.
  const heroArt = backdropSrc ?? posterSrc ?? (version.stillHash ? apiPaths.videoStillUrl(version.id, version.stillHash, "small") : null);
  const res = resolutionLabel(version.file.width, version.file.height);
  const pills = [movie.year, duration(version.durationSec), res].filter(Boolean) as string[];
  const playSub = started ? timeLeft(version.durationSec, position) : duration(version.durationSec);

  const mark = async (done: boolean) => {
    try {
      await setFinished("video", movie.id, version.durationSec, done);
      toast(done ? "Marked as watched" : "Marked as not watched");
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
            "--tint": movie.color ?? "#2a3550",
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
          <Poster kind="movie" id={movie.id} hash={movie.posterHash} color={movie.color} title={movie.title} sub={movie.year} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 4, minWidth: 0 }}>
            <h1 className="show-title">{movie.title}</h1>
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
        <Link
          className="btn btn-primary btn-big"
          aria-label={`${started ? "Resume" : "Play"}, ${playSub}`}
          href={playHref("movie", movie.id, versionId === movie.versionList[0]!.id ? undefined : versionId, quality)}
        >
          <PlayIcon size={22} />
          <span>{playSub}</span>
        </Link>
        <QualityPick file={version.file} value={quality} onChange={setQuality} />
        <button
          type="button"
          className="btn-round"
          aria-label={finished ? "Mark as not watched" : "Mark as watched"}
          aria-pressed={finished}
          onClick={() => mark(!finished)}
        >
          <CheckIcon />
        </button>
      </div>

      {movie.description ? (
        <>
          <p className={`description ${expanded ? "" : "clamped"}`}>{movie.description}</p>
          {!expanded && movie.description.length > 220 ? (
            <button type="button" className="more-link" onClick={() => setExpanded(true)}>
              More
            </button>
          ) : null}
        </>
      ) : null}

      {movie.versionList.length > 1 ? (
        <div style={{ marginTop: 18 }}>
          <SettingsCard>
            <button type="button" className="setting setting-link" onClick={() => setPicking(true)}>
              <span className="setting-title">Version</span>
              <span className="setting-value">
                <span>{versionLabel(version)}</span>
                <ChevronIcon />
              </span>
            </button>
          </SettingsCard>
        </div>
      ) : null}

      <FileDetails file={version.file} />

      <Sheet open={picking} onClose={() => setPicking(false)} title="Version">
        {movie.versionList.map((v) => (
          <SheetItem
            key={v.id}
            active={v.id === versionId}
            onClick={() => {
              setVersionId(v.id);
              setPicking(false);
            }}
          >
            <span style={{ flex: 1 }}>{versionLabel(v)}</span>
            <span className="muted small">{duration(v.durationSec)}</span>
          </SheetItem>
        ))}
      </Sheet>

      <Sheet open={menu} onClose={() => setMenu(false)} title={movie.title}>
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
        <WatchMatchDialog kind="movie" id={movie.id} title={movie.title} year={movie.year} tmdbId={movie.tmdbId} onClose={() => setMatching(false)} />
      ) : null}
    </>
  );
}
