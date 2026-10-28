"use client";

import { toast } from "sonner";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  apiPaths,
  type EpisodeWithShow,
  NEW_EPISODES_PAGE,
  newByShow,
  PODCAST_LIST_TITLES,
  PODCAST_SECTION_SIZE,
  PODCAST_SORT_LABEL,
  type PodcastListId,
  type PodcastSort,
  type OpmlImportResult,
  plural,
  type PodcastSearchResult,
  type PodcastSummary,
  sortShows,
} from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { FilterIcon, PlusIcon } from "../icons";
import { EmptyState, NestedHead, ScrollRow, SearchBox, SectionTitle } from "../ui";
import { Sheet, SheetItem } from "../sheet";
import { EpisodeRow } from "./episode-row";

function PodcastCard({ podcast: p }: { podcast: PodcastSummary }) {
  return (
    <Link href={`/podcasts/${p.id}`} className="card" title={p.title}>
      <Cover src={p.coverHash ? apiPaths.podcastCoverUrl(p.id, p.coverHash, 200) : null} color={p.coverColor} title={p.title} />
      {p.unplayedCount > 0 ? <span className="badge-count">{p.unplayedCount > 99 ? "99+" : p.unplayedCount}</span> : null}
      <div className="card-title">{p.title}</div>
      {p.lastError ? <div className="card-sub error">Feed problem</div> : null}
    </Link>
  );
}

/** A section heading that opens the full list, with its count. */
function SectionHead({ title, count, noun, onOpen }: { title: string; count: number; noun: string; onOpen: () => void }) {
  return (
    <div className="section-head">
      <SectionTitle title={title} count={count} noun={noun} onOpen={onOpen} />
    </div>
  );
}

export function PodcastsView({
  podcasts,
  continueEpisodes,
  newEpisodes,
}: {
  podcasts: PodcastSummary[];
  continueEpisodes: EpisodeWithShow[];
  newEpisodes: EpisodeWithShow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Coming back from a search result reopens Add podcast with the same search.
  const addQuery = params.get("add");
  const [adding, setAdding] = useState(addQuery !== null);
  const [sortOpen, setSortOpen] = useState(false);
  const [sort, setSort] = useState<PodcastSort>("latest");
  const [newShown, setNewShown] = useState(NEW_EPISODES_PAGE);
  const refresh = () => router.refresh();
  const listParam = params.get("list");
  const list = listParam && listParam in PODCAST_LIST_TITLES ? (listParam as PodcastListId) : null;

  const shows = useMemo(() => sortShows(podcasts, sort), [podcasts, sort]);
  const groups = useMemo(() => newByShow(newEpisodes), [newEpisodes]);

  // Every list is built from data already here, so skip the server round trip, like the Library shelves.
  const open = (id: PodcastListId) => {
    window.history.pushState(null, "", `${pathname}?list=${id}`);
    window.scrollTo(0, 0);
  };

  const sortButton =
    podcasts.length > 1 ? (
      <button type="button" className="icon-btn" aria-label="Sort podcasts" onClick={() => setSortOpen(true)}>
        <FilterIcon />
      </button>
    ) : null;

  const sheets = (
    <>
      <AddPodcastSheet
        open={adding}
        initialQuery={addQuery ?? ""}
        onClose={() => {
          setAdding(false);
          if (addQuery !== null) window.history.replaceState(null, "", pathname);
        }}
        onAdded={(id) => {
          setAdding(false);
          // Refresh first so going back from the new podcast shows it in the list,
          // instead of the cached page from before subscribing.
          refresh();
          if (id) router.push(`/podcasts/${id}`);
        }}
      />

      <Sheet open={sortOpen} onClose={() => setSortOpen(false)} title="Sort podcasts">
        {(Object.keys(PODCAST_SORT_LABEL) as PodcastSort[]).map((s) => (
          <SheetItem
            key={s}
            active={s === sort}
            onClick={() => {
              setSort(s);
              setSortOpen(false);
            }}
          >
            {PODCAST_SORT_LABEL[s]}
          </SheetItem>
        ))}
      </Sheet>
    </>
  );

  // A section's full list, opened from its heading.
  if (list) {
    const count = list === "continue" ? continueEpisodes.length : list === "new" ? newEpisodes.length : podcasts.length;
    return (
      <>
        <NestedHead
          title={PODCAST_LIST_TITLES[list]}
          count={count}
          noun={list === "podcasts" ? "podcast" : "episode"}
          fallback="/podcasts"
          actions={list === "podcasts" ? sortButton : null}
        />
        {count === 0 ? (
          <EmptyState>Nothing here right now.</EmptyState>
        ) : list === "podcasts" ? (
          <div className="grid">
            {shows.map((p) => (
              <PodcastCard key={p.id} podcast={p} />
            ))}
          </div>
        ) : list === "continue" ? (
          <div>
            {continueEpisodes.map((e) => (
              <EpisodeRow key={e.id} episode={e} showThumb onChanged={refresh} />
            ))}
          </div>
        ) : (
          <>
            <div>
              {newEpisodes.slice(0, newShown).map((e) => (
                <EpisodeRow key={e.id} episode={e} showThumb onChanged={refresh} />
              ))}
            </div>
            {newShown < newEpisodes.length ? (
              <div className="more-row">
                <button type="button" className="btn" onClick={() => setNewShown((n) => n + NEW_EPISODES_PAGE)}>
                  Show more
                </button>
              </div>
            ) : null}
          </>
        )}
        {sheets}
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Podcasts</h1>
        <div className="head-actions">
          {sortButton}
          <button type="button" className="icon-btn accent" aria-label="Add podcast" onClick={() => setAdding(true)}>
            <PlusIcon />
          </button>
        </div>
      </div>

      {podcasts.length === 0 ? (
        <EmptyState title="No podcasts yet">
          <div style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              Add a podcast
            </button>
          </div>
        </EmptyState>
      ) : (
        <>
          <section className="section" style={{ marginTop: 0 }}>
            <SectionHead title={PODCAST_LIST_TITLES.podcasts} count={podcasts.length} noun="podcast" onOpen={() => open("podcasts")} />
            <ScrollRow>
              {shows.map((p) => (
                <PodcastCard key={p.id} podcast={p} />
              ))}
            </ScrollRow>
          </section>

          {continueEpisodes.length ? (
            <section className="section">
              <SectionHead title={PODCAST_LIST_TITLES.continue} count={continueEpisodes.length} noun="episode" onOpen={() => open("continue")} />
              <div>
                {continueEpisodes.slice(0, PODCAST_SECTION_SIZE).map((e) => (
                  <EpisodeRow key={e.id} episode={e} showThumb onChanged={refresh} />
                ))}
              </div>
            </section>
          ) : null}

          {groups.length ? (
            <section className="section">
              <SectionHead title={PODCAST_LIST_TITLES.new} count={newEpisodes.length} noun="episode" onOpen={() => open("new")} />
              <div>
                {groups.slice(0, PODCAST_SECTION_SIZE).map((g) => (
                  <EpisodeRow key={g.episode.id} episode={g.episode} showThumb newCount={g.count} onChanged={refresh} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      {sheets}
    </>
  );
}

/**
 * Find a podcast by name and subscribe in one tap, or open a result to look first.
 * Searches as you type. The search is kept in the URL so back from a result returns to it.
 */
function PodcastSearch({ initialQuery, onAdded }: { initialQuery: string; onAdded: (id: string | null) => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(initialQuery);

  const openResult = (r: PodcastSearchResult) => {
    window.history.replaceState(null, "", `${pathname}?add=${encodeURIComponent(query.trim())}`);
    router.push(r.subscribedId ? `/podcasts/${r.subscribedId}` : `/podcasts/preview?feed=${encodeURIComponent(r.feedUrl)}`);
  };
  const [results, setResults] = useState<PodcastSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setError(null);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      setSearching(true);
      api<PodcastSearchResult[]>(`/api/podcasts/search?q=${encodeURIComponent(q)}`)
        .then((r) => {
          if (stale) return;
          setResults(r);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!stale) setError(err instanceof Error ? err.message : "Search failed.");
        })
        .finally(() => {
          if (!stale) setSearching(false);
        });
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  const subscribe = async (r: PodcastSearchResult) => {
    setAdding(r.feedUrl);
    try {
      const podcast = await api<PodcastSummary>("/api/podcasts", { method: "POST", body: { feedUrl: r.feedUrl } });
      toast(`Subscribed to ${podcast.title}`);
      onAdded(podcast.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't subscribe.");
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="form">
      <SearchBox value={query} onChange={setQuery} placeholder="Search podcasts" label="Search podcasts" />
      {error ? (
        <p className="error small" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      {searching && !results ? (
        <div className="loading-center" style={{ padding: 24 }} aria-busy="true" aria-label="Searching">
          <div className="spinner" />
        </div>
      ) : results ? (
        results.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No podcasts found.
          </p>
        ) : (
          <div className="list search-results" aria-busy={searching || undefined}>
            {results.map((r) => (
              <div key={r.feedUrl} className="list-row">
                <button type="button" className="search-result-open" onClick={() => openResult(r)}>
                  <Cover className="thumb" src={r.thumbUrl}color={null} title={r.title} />
                  <span className="list-row-main">
                    <span className="list-row-title" style={{ fontSize: 14 }}>
                      {r.title}
                    </span>
                    {r.author ? <span className="list-row-sub">{r.author}</span> : null}
                    {r.episodeCount ? <span className="list-row-sub">{plural(r.episodeCount, "episode")}</span> : null}
                  </span>
                </button>
                {r.subscribedId ? (
                  <button type="button" className="btn" onClick={() => openResult(r)}>
                    Open
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" disabled={adding !== null} onClick={() => void subscribe(r)}>
                    {adding === r.feedUrl ? "Adding…" : "Subscribe"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

function AddPodcastSheet({
  open,
  initialQuery,
  onClose,
  onAdded,
}: {
  open: boolean;
  initialQuery: string;
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
      const text = `Added ${plural(data.added, "podcast")}, ${data.alreadySubscribed} already followed.${failed}`;
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
      <PodcastSearch initialQuery={initialQuery} onAdded={onAdded} />
      <form className="form" onSubmit={subscribe}>
        <label className="label">
          Or paste an RSS feed URL
          <input
            className="input"
            type="url"
            inputMode="url"
            placeholder="https://feeds.example.com/show.xml"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || !url.trim()}>
          {busy ? "Adding…" : "Subscribe"}
        </button>
      </form>
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
