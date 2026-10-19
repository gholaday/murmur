"use client";

import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  duration,
  plural,
  type PodcastPreview,
  type PodcastPreviewEpisode,
  type PodcastSummary,
  shortDate,
} from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { BackIcon, PlusIcon } from "../icons";

const PAGE = 20;

function back(router: ReturnType<typeof useRouter>) {
  if (window.history.length > 1) router.back();
  else router.push("/podcasts");
}

/** A podcast from search, read live from its feed, with Subscribe. Episodes can't be played yet. */
export function PreviewView({ preview, error }: { preview?: PodcastPreview; error?: string }) {
  const router = useRouter();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(false);

  if (!preview) {
    return (
      <>
        <div className="back-row">
          <button type="button" className="icon-btn" onClick={() => back(router)} aria-label="Back">
            <BackIcon />
          </button>
        </div>
        <div className="empty">
          <strong>Couldn&apos;t open this podcast</strong>
          {error}
        </div>
      </>
    );
  }

  const subscribe = async () => {
    setBusy(true);
    try {
      const podcast = await api<PodcastSummary>("/api/podcasts", { method: "POST", body: { feedUrl: preview.feedUrl } });
      toast(`Subscribed to ${podcast.title}`);
      // Replace, so back from the new podcast goes to the search, not this preview.
      router.replace(`/podcasts/${podcast.id}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't subscribe.");
      setBusy(false);
    }
  };

  return (
    <>
      <div className="hero" style={{ "--tint": "#1b3532" } as React.CSSProperties}>
        <div className="hero-bar">
          <button type="button" className="icon-btn" aria-label="Back" onClick={() => back(router)}>
            <BackIcon />
          </button>
        </div>
        <div className="show-hero">
          <Cover src={preview.artworkUrl} color={null} title={preview.title} large />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingBottom: 4, minWidth: 0 }}>
            <h1 className="show-title">{preview.title}</h1>
            {preview.author ? <div className="show-by">{preview.author}</div> : null}
            <div className="show-by muted" style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px" }}>
              <span>{plural(preview.episodeCount, "episode")}</span>
              {preview.latestPublishedAt ? <span>Latest {shortDate(preview.latestPublishedAt)}</span> : null}
            </div>
          </div>
        </div>
        <div className="show-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void subscribe()}>
            <PlusIcon size={16} />
            {busy ? "Subscribing…" : "Subscribe"}
          </button>
        </div>
      </div>

      {preview.description ? (
        <>
          <p className={`description ${aboutOpen ? "" : "clamped"}`} style={{ WebkitLineClamp: aboutOpen ? undefined : 2 }}>
            {preview.description}
          </p>
          {preview.description.length > 140 ? (
            <button type="button" className="more-link" onClick={() => setAboutOpen((o) => !o)}>
              {aboutOpen ? "Less" : "More"}
            </button>
          ) : null}
        </>
      ) : null}

      <div className="subtabs">
        <h2 className="subtab subtab-static">Episodes</h2>
      </div>

      {preview.episodes.length === 0 ? (
        <div className="empty">No episodes.</div>
      ) : (
        <div>
          {preview.episodes.slice(0, limit).map((e) => (
            <PreviewEpisodeRow key={e.guid} episode={e} />
          ))}
          {preview.episodes.length > limit ? (
            <div className="more-row">
              <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE)}>
                Show more
              </button>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}

function PreviewEpisodeRow({ episode }: { episode: PodcastPreviewEpisode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`episode ${open ? "episode-open" : ""}`}>
      <div className="episode-main">
        <button type="button" className="episode-text" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="episode-meta">
            <span className="episode-date">{shortDate(episode.publishedAt)}</span>
            {episode.durationSec ? <span className="episode-date">{duration(episode.durationSec)}</span> : null}
          </span>
          <span className="episode-title">{episode.title}</span>
          {episode.description ? <span className="episode-desc">{episode.description}</span> : null}
        </button>
      </div>
    </div>
  );
}
