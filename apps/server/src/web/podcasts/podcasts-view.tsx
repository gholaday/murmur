"use client";

import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiPaths, type EpisodeWithShow, type OpmlImportResult, plural, type PodcastSummary } from "@murmur/shared";
import { api } from "../api";
import { Cover } from "../cover";
import { FilterIcon, PlusIcon } from "../icons";
import { Sheet, SheetItem } from "../sheet";
import { EpisodeRow } from "./episode-row";

type Sort = "latest" | "title" | "unplayed";
const SORT_LABEL: Record<Sort, string> = { latest: "Latest episode", title: "Title", unplayed: "Most unplayed" };

function sortShows(shows: PodcastSummary[], sort: Sort) {
  const out = [...shows];
  if (sort === "title") return out.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "unplayed") return out.sort((a, b) => b.unplayedCount - a.unplayedCount || a.title.localeCompare(b.title));
  return out.sort((a, b) => (b.latestPublishedAt ?? 0) - (a.latestPublishedAt ?? 0));
}

export function PodcastsView({ podcasts, newEpisodes }: { podcasts: PodcastSummary[]; newEpisodes: EpisodeWithShow[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [sort, setSort] = useState<Sort>("latest");
  const [showAll, setShowAll] = useState(false);
  const refresh = () => router.refresh();

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Podcasts</h1>
        <div className="head-actions">
          {podcasts.length > 1 ? (
            <button type="button" className="icon-btn" aria-label="Sort shows" onClick={() => setSortOpen(true)}>
              <FilterIcon />
            </button>
          ) : null}
          <button type="button" className="icon-btn accent" aria-label="Add podcast" onClick={() => setAdding(true)}>
            <PlusIcon />
          </button>
        </div>
      </div>

      {podcasts.length === 0 ? (
        <div className="empty">
          <strong>No podcasts yet</strong>
          Add a show by pasting its RSS feed, or import an OPML file from your old app.
          <div style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              Add a podcast
            </button>
          </div>
        </div>
      ) : (
        <>
          {newEpisodes.length ? (
            <section className="section" style={{ marginTop: 0 }}>
              <div className="section-head">
                <h2 className="section-title">New episodes</h2>
                {newEpisodes.length > 4 ? (
                  <button type="button" className="section-link" onClick={() => setShowAll((s) => !s)}>
                    {showAll ? "Show less" : "See all"}
                  </button>
                ) : null}
              </div>
              <div>
                {(showAll ? newEpisodes : newEpisodes.slice(0, 4)).map((e) => (
                  <EpisodeRow key={e.id} episode={e} showThumb onChanged={refresh} />
                ))}
              </div>
            </section>
          ) : null}

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">Your shows</h2>
              <span className="muted small">{plural(podcasts.length, "show")}</span>
            </div>
            <div className="grid">
              {sortShows(podcasts, sort).map((p) => (
                <Link key={p.id} href={`/podcasts/${p.id}`} className="card" title={p.title}>
                  <Cover
                    src={p.coverHash ? apiPaths.podcastCoverUrl(p.id, p.coverHash, 200) : null}
                    color={p.coverColor}
                    title={p.title}
                  />
                  {p.unplayedCount > 0 ? <span className="badge-count">{p.unplayedCount > 99 ? "99+" : p.unplayedCount}</span> : null}
                  <div className="card-title">{p.title}</div>
                  {p.lastError ? <div className="card-sub error">Feed problem</div> : null}
                </Link>
              ))}
            </div>
          </section>
        </>
      )}

      <AddPodcastSheet
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(id) => {
          setAdding(false);
          if (id) router.push(`/podcasts/${id}`);
          else refresh();
        }}
      />

      <Sheet open={sortOpen} onClose={() => setSortOpen(false)} title="Sort shows">
        {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
          <SheetItem
            key={s}
            active={s === sort}
            onClick={() => {
              setSort(s);
              setSortOpen(false);
            }}
          >
            {SORT_LABEL[s]}
          </SheetItem>
        ))}
      </Sheet>
    </>
  );
}

function AddPodcastSheet({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  /** The new show's id, or null after an OPML import. */
  onAdded: (id: string | null) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const subscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const podcast = await api<PodcastSummary>("/api/podcasts", { method: "POST", body: { feedUrl: url.trim() } });
      setUrl("");
      toast(`Subscribed to ${podcast.title}`);
      onAdded(podcast.id);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Couldn't add that feed.", error: true });
    } finally {
      setBusy(false);
    }
  };

  const importOpml = async (file: File) => {
    setBusy(true);
    setMessage({ text: "Importing… large lists can take a minute.", error: false });
    try {
      const res = await fetch("/api/podcasts/opml", { method: "POST", headers: { "Content-Type": "text/xml" }, body: await file.text() });
      const data = (await res.json()) as OpmlImportResult | { error: string };
      if (!res.ok || "error" in data) throw new Error("error" in data ? data.error : "Import failed.");
      const failed = data.failed.length ? ` ${data.failed.length} couldn't be loaded.` : "";
      const text = `Added ${plural(data.added, "show")}, ${data.alreadySubscribed} already followed.${failed}`;
      setMessage(null);
      if (data.failed.length) toast.error(text);
      else toast(text);
      if (data.added) onAdded(null);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Import failed.", error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add a podcast">
      <form className="form" onSubmit={subscribe}>
        <label className="label">
          RSS feed URL
          <input
            className="input"
            type="url"
            inputMode="url"
            placeholder="https://feeds.example.com/show.xml"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            autoFocus
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || !url.trim()}>
          {busy ? "Adding…" : "Subscribe"}
        </button>
      </form>
      <div className="muted small" style={{ marginTop: 8 }}>
        Moving from another app? Import its OPML export.
      </div>
      <div className="form-row">
        <label className="btn" style={{ flex: 1, cursor: "pointer" }}>
          Import OPML
          <input
            type="file"
            accept=".opml,.xml,text/xml,application/xml"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void importOpml(f);
            }}
          />
        </label>
        <a className="btn" style={{ flex: 1 }} href="/api/podcasts/opml" download="murmur-podcasts.opml">
          Export OPML
        </a>
      </div>
      {message ? (
        <p className={message.error ? "error small" : "muted small"} role="status">
          {message.text}
        </p>
      ) : null}
    </Sheet>
  );
}
