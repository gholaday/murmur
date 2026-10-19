"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { apiPaths, type EpisodeDto, type EpisodeWithShow, type PodcastDetail } from "@murmur/shared";
import { api } from "../api";
import { Cover } from "../cover";
import { plural, shortDate } from "../format";
import { BackIcon, CheckIcon, DownloadIcon, MoreIcon } from "../icons";
import { Sheet, SheetItem } from "../sheet";
import { EpisodeRow } from "./episode-row";

const PAGE = 50;
const KEEP_OPTIONS = [1, 2, 3, 5, 10, 20];

export function ShowView({ podcast, episodes, isAdmin }: { podcast: PodcastDetail; episodes: EpisodeDto[]; isAdmin: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"episodes" | "archived">("episodes");
  const [oldestFirst, setOldestFirst] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [sheet, setSheet] = useState<null | "menu" | "download" | "unsubscribe">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  const withShow: EpisodeWithShow[] = useMemo(
    () =>
      episodes.map((e) => ({
        ...e,
        podcastTitle: podcast.title,
        podcastCoverHash: podcast.coverHash,
        podcastCoverColor: podcast.coverColor,
        speed: podcast.speed,
      })),
    [episodes, podcast],
  );
  const visible = useMemo(() => {
    const list = withShow.filter((e) => (tab === "archived" ? e.archived : !e.archived));
    return oldestFirst ? [...list].reverse() : list;
  }, [withShow, tab, oldestFirst]);
  const archivedCount = withShow.filter((e) => e.archived).length;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const updateDownloads = (body: { autoDownload?: boolean; keepLatest?: number }) =>
    run(() => api(`/api/podcasts/${podcast.id}`, { method: "PATCH", body }));

  return (
    <>
      <div className="hero" style={{ "--tint": podcast.coverColor ?? "#1b3532" } as React.CSSProperties}>
        <div className="hero-bar">
          <button
            type="button"
            className="icon-btn"
            aria-label="Back"
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/podcasts"))}
          >
            <BackIcon />
          </button>
          <button type="button" className="icon-btn" aria-label="Show options" onClick={() => setSheet("menu")}>
            <MoreIcon />
          </button>
        </div>
        <div className="show-hero">
          <Cover
            src={podcast.coverHash ? apiPaths.podcastCoverUrl(podcast.id, podcast.coverHash, 600) : null}
            color={podcast.coverColor}
            title={podcast.title}
            large
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingBottom: 4, minWidth: 0 }}>
            <h1 className="show-title">{podcast.title}</h1>
            {podcast.author ? <div className="show-by">{podcast.author}</div> : null}
            <div className="show-by muted">
              {plural(podcast.episodeCount, "episode")}
              {podcast.latestPublishedAt ? ` · Latest ${shortDate(podcast.latestPublishedAt)}` : ""}
            </div>
          </div>
        </div>
        <div className="show-actions" style={{ "--tint": podcast.coverColor ?? "#1b3532" } as React.CSSProperties}>
          <button type="button" className="btn btn-primary" onClick={() => setSheet("unsubscribe")}>
            <CheckIcon size={16} />
            Subscribed
          </button>
          {isAdmin ? (
            <button type="button" className="btn btn-tint" onClick={() => setSheet("download")}>
              <DownloadIcon size={16} />
              {podcast.autoDownload ? `Auto-download: last ${podcast.keepLatest}` : "Auto-download off"}
            </button>
          ) : podcast.autoDownload ? (
            <span className="btn btn-tint" aria-disabled="true">
              <DownloadIcon size={16} />
              Auto-download: last {podcast.keepLatest}
            </span>
          ) : null}
        </div>
      </div>

      {podcast.lastError ? (
        <p className="error small" role="alert">
          Last feed check failed: {podcast.lastError}
        </p>
      ) : null}
      {error ? (
        <p className="error small" role="alert">
          {error}
        </p>
      ) : null}

      {podcast.description ? (
        <>
          <p className={`description ${aboutOpen ? "" : "clamped"}`} style={{ WebkitLineClamp: aboutOpen ? undefined : 2 }}>
            {podcast.description}
          </p>
          {podcast.description.length > 140 ? (
            <button type="button" className="more-link" onClick={() => setAboutOpen((o) => !o)}>
              {aboutOpen ? "Less" : "More"}
            </button>
          ) : null}
        </>
      ) : null}

      <div className="subtabs" role="tablist">
        <button type="button" role="tab" className="subtab" aria-selected={tab === "episodes"} onClick={() => setTab("episodes")}>
          Episodes
        </button>
        <button type="button" role="tab" className="subtab" aria-selected={tab === "archived"} onClick={() => setTab("archived")}>
          Archived{archivedCount ? ` (${archivedCount})` : ""}
        </button>
        <button type="button" className="muted small" onClick={() => setOldestFirst((o) => !o)}>
          {oldestFirst ? "Oldest first" : "Newest first"}
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="empty">{tab === "archived" ? "Episodes you archive show up here." : "No episodes."}</div>
      ) : (
        <div>
          {visible.slice(0, limit).map((e) => (
            <EpisodeRow key={e.id} episode={e} onChanged={() => router.refresh()} />
          ))}
          {visible.length > limit ? (
            <div style={{ textAlign: "center", padding: 16 }}>
              <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE)}>
                Show more ({visible.length - limit} left)
              </button>
            </div>
          ) : null}
        </div>
      )}

      <Sheet open={sheet === "menu"} onClose={() => setSheet(null)} title={podcast.title}>
        <SheetItem
          disabled={busy}
          onClick={() => {
            setSheet(null);
            void run(() => api(`/api/podcasts/${podcast.id}/refresh`, { method: "POST" }));
          }}
        >
          {busy ? "Checking…" : "Check for new episodes"}
        </SheetItem>
        {podcast.link ? (
          <a className="sheet-item" href={podcast.link} target="_blank" rel="noreferrer">
            Show website
          </a>
        ) : null}
        <SheetItem
          onClick={() => {
            void navigator.clipboard?.writeText(podcast.feedUrl);
            setSheet(null);
          }}
        >
          Copy feed URL
        </SheetItem>
        <SheetItem danger onClick={() => setSheet("unsubscribe")}>
          Unsubscribe
        </SheetItem>
      </Sheet>

      <Sheet open={sheet === "download"} onClose={() => setSheet(null)} title="Auto-download">
        <label className="switch">
          <span className="setting-text">
            <span className="setting-title">Download new episodes</span>
            <span className="setting-sub">Plays from the server&apos;s copy, even if the publisher is slow. Applies to everyone.</span>
          </span>
          <input
            type="checkbox"
            checked={podcast.autoDownload}
            disabled={busy}
            onChange={(e) => void updateDownloads({ autoDownload: e.target.checked })}
          />
        </label>
        <div className="label">
          Keep the newest
          <div className="chip-grid" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
            {KEEP_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                className="chip"
                aria-pressed={podcast.keepLatest === n}
                disabled={busy}
                onClick={() => void updateDownloads({ keepLatest: n })}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </Sheet>

      <Sheet open={sheet === "unsubscribe"} onClose={() => setSheet(null)} title={`Unsubscribe from ${podcast.title}?`}>
        <p className="muted" style={{ margin: 0 }}>
          Your listening history for this show is removed from your lists.
        </p>
        <div className="form-row">
          <button type="button" className="btn" style={{ flex: 1 }} onClick={() => setSheet(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/api/podcasts/${podcast.id}`, { method: "DELETE" });
                router.push("/podcasts");
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Couldn't unsubscribe.");
                setBusy(false);
                setSheet(null);
              }
            }}
          >
            Unsubscribe
          </button>
        </div>
      </Sheet>
    </>
  );
}
