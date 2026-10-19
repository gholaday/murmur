"use client";

import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { apiPaths, type EpisodeDto, type EpisodeWithShow, plural, type PodcastDetail, shortDate } from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { BackIcon, CheckIcon, MoreIcon } from "../icons";
import { Sheet, SheetItem } from "../sheet";
import { EpisodeRow } from "./episode-row";

export function ShowView({
  podcast,
  pageSize,
  firstPage,
}: {
  podcast: PodcastDetail;
  /** Episodes shown per page; `firstPage` holds the newest page. */
  pageSize: number;
  firstPage: EpisodeDto[];
}) {
  const router = useRouter();
  const [oldestFirst, setOldestFirst] = useState(false);
  const [limit, setLimit] = useState(pageSize);
  const [sheet, setSheet] = useState<null | "menu" | "unsubscribe">(null);
  const [busy, setBusy] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  // Every episode, fetched the first time you need more than the first page.
  const [all, setAll] = useState<EpisodeDto[] | null>(null);
  const complete = all !== null || firstPage.length >= podcast.episodeCount;
  const episodes = all ?? firstPage;

  const loadAll = async () => {
    try {
      setAll(await api<EpisodeDto[]>(`/api/podcasts/${podcast.id}/episodes?short=1`));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load the episodes.");
    }
  };
  const changed = () => {
    router.refresh();
    if (all) void loadAll();
  };

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
  // Oldest first waits for the full list, so it never shows the first page backwards.
  const visible = useMemo(
    () => (oldestFirst && complete ? [...withShow].reverse() : withShow),
    [withShow, oldestFirst, complete],
  );

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
      changed();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

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
          <button type="button" className="icon-btn" aria-label="Podcast options" onClick={() => setSheet("menu")}>
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
            <div className="show-by muted" style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px" }}>
              <span>{plural(podcast.episodeCount, "episode")}</span>
              {podcast.latestPublishedAt ? <span>Latest {shortDate(podcast.latestPublishedAt)}</span> : null}
            </div>
          </div>
        </div>
        <div className="show-actions" style={{ "--tint": podcast.coverColor ?? "#1b3532" } as React.CSSProperties}>
          <button type="button" className="btn btn-primary" onClick={() => setSheet("unsubscribe")}>
            <CheckIcon size={16} />
            Subscribed
          </button>
        </div>
      </div>

      {podcast.lastError ? (
        <p className="error small" role="alert">
          Last feed check failed: {podcast.lastError}
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

      <div className="subtabs">
        <h2 className="subtab subtab-static">Episodes</h2>
        <button
          type="button"
          className="muted small"
          onClick={() => {
            if (!complete) void loadAll();
            setOldestFirst((o) => !o);
          }}
        >
          {oldestFirst ? "Oldest first" : "Newest first"}
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="empty">No episodes.</div>
      ) : (
        <div>
          {visible.slice(0, limit).map((e) => (
            <EpisodeRow key={e.id} episode={e} onChanged={changed} />
          ))}
          {(complete ? visible.length : podcast.episodeCount) > limit ? (
            <div style={{ textAlign: "center", padding: 16 }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (!complete) void loadAll();
                  setLimit((l) => l + pageSize);
                }}
              >
                Show more ({(complete ? visible.length : podcast.episodeCount) - limit} left)
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
            void run(() => api(`/api/podcasts/${podcast.id}/refresh`, { method: "POST" }), "Checked for new episodes");
          }}
        >
          {busy ? "Checking…" : "Check for new episodes"}
        </SheetItem>
        {podcast.link ? (
          <a className="sheet-item" href={podcast.link} target="_blank" rel="noreferrer">
            Podcast website
          </a>
        ) : null}
        <SheetItem
          onClick={() => {
            void navigator.clipboard?.writeText(podcast.feedUrl).then(() => toast("Feed URL copied"));
            setSheet(null);
          }}
        >
          Copy feed URL
        </SheetItem>
        <SheetItem danger onClick={() => setSheet("unsubscribe")}>
          Unsubscribe
        </SheetItem>
      </Sheet>

      <Sheet open={sheet === "unsubscribe"} onClose={() => setSheet(null)} title={`Unsubscribe from ${podcast.title}?`}>
        <p className="muted" style={{ margin: 0 }}>
          Your listening history for this podcast is removed from your lists.
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
                toast(`Unsubscribed from ${podcast.title}`);
                router.push("/podcasts");
                router.refresh();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Couldn't unsubscribe.");
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
