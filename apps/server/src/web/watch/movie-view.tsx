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
  pastStart,
  resolutionLabel,
  timeLeft,
  type VideoFileInfo,
  type VideoQuality,
  versionLabel,
  type WatchPoster,
} from "@murmur/shared/client";
import { CheckIcon, ChevronIcon, MoreIcon, PlayIcon } from "../icons";
import { setFinished } from "../progress";
import { Sheet, SheetItem } from "../sheet";
import { BackButton, ScrollRow, SectionTitle, SettingsCard } from "../ui";
import { playHref, Poster, PosterCard } from "./cards";
import { useAdmin } from "../admin";
import { MenuSheet } from "../card-menu";
import { WatchEditDialog, type WatchEditTab } from "./edit-sheet";
import { WatchMenuItems } from "./poster-menu";
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

/** A row of films on a movie's page: its collection, or ones like it. This film's card is marked. */
function MovieShelf({ title, items, current }: { title: string; items: WatchPoster[]; current: string }) {
  return (
    <section className="section">
      <SectionTitle title={title} />
      <ScrollRow>
        {items.map((p) => (
          <div key={p.id} className={p.id === current ? "card-current" : undefined}>
            <PosterCard kind="movie" id={p.id} title={p.title} year={p.year} posterHash={p.posterHash} color={p.color} watched={p.watched} />
          </div>
        ))}
      </ScrollRow>
    </section>
  );
}

/** A movie: poster, Play or Resume, Mark watched, the description, its versions, its shelves and the file. */
export function MovieView({ movie }: { movie: MovieDetail }) {
  const router = useRouter();
  const { tmdb } = useAdmin();
  const [expanded, setExpanded] = useState(false);
  const [picking, setPicking] = useState(false);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState<WatchEditTab | null>(null);
  const [versionId, setVersionId] = useState(movie.versionList[0]!.id);
  /** A converted-video quality picked for this viewing; null means your setting. */
  const [quality, setQuality] = useState<VideoQuality | null>(null);
  const version = movie.versionList.find((v) => v.id === versionId) ?? movie.versionList[0]!;
  const finished = !!movie.progress?.finished;
  const position = movie.progress && !finished ? movie.progress.positionSec : 0;
  const started = pastStart(position);
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
          <button type="button" className="icon-btn" aria-label="More options" onClick={() => setMenu(true)}>
            <MoreIcon />
          </button>
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

      {movie.collection ? <MovieShelf title={movie.collection.name} items={movie.collection.items} current={movie.id} /> : null}
      {movie.similar?.length ? <MovieShelf title="More like this" items={movie.similar} current={movie.id} /> : null}

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

      <MenuSheet
        open={menu}
        onClose={() => setMenu(false)}
        title={movie.title}
        items={(choose) => (
          <WatchMenuItems
            kind="movie"
            id={movie.id}
            watched={finished}
            resume={started}
            playHref={playHref}
            load={async () => movie}
            edit={setEditing}
            choose={choose}
          />
        )}
      />
      {editing ? <WatchEditDialog kind="movie" item={movie} tab={editing} canMatch={tmdb} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
