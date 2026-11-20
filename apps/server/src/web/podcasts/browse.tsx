"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  apiPaths,
  BROWSE_TOP_SIZE,
  errorText,
  feedLinkIn,
  type OpmlImportResult,
  PODCAST_GENRES,
  type PodcastBrowse,
  type PodcastMoreLike,
  type PodcastPreview,
  type PodcastSearchResult,
  type PodcastSummary,
  plural,
} from "@murmur/shared/client";
import { api } from "../api";
import { CardMenu, MenuItem } from "../card-menu";
import { Cover } from "../cover";
import { CheckIcon, CloseIcon, HeartIcon, SearchIcon } from "../icons";
import { Chip, Chips, EmptyState, NestedHead, ScrollRow, SectionTitle } from "../ui";

/**
 * Browse: finding shows to follow. Every show here (a search result, a chart entry, a suggestion)
 * is the same PodcastSearchResult and works the same way: the show opens its preview, and the
 * heart subscribes in place, turning into a check that opens the show.
 */

type Directory = {
  /** Your podcast's id for a feed you follow, counting ones followed since the list loaded. */
  followedId: (s: PodcastSearchResult) => string | null;
  subscribe: (s: PodcastSearchResult) => Promise<void>;
  busy: string | null;
  isDismissed: (s: PodcastSearchResult) => boolean;
  notInterested: (s: PodcastSearchResult) => Promise<void>;
};

const DirectoryContext = createContext<Directory | null>(null);

function useDirectory(): Directory {
  const d = useContext(DirectoryContext);
  if (!d) throw new Error("useDirectory needs a DirectoryProvider");
  return d;
}

function DirectoryProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [followed, setFollowed] = useState<Record<string, string>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  // One value until something here changes, so typing in the box doesn't redraw every card and row.
  const value = useMemo<Directory>(() => {
    const subscribe = async (s: PodcastSearchResult) => {
      setBusy(s.feedUrl);
      try {
        const podcast = await api<PodcastSummary>(apiPaths.podcasts, { method: "POST", body: { feedUrl: s.feedUrl } });
        setFollowed((f) => ({ ...f, [s.feedUrl]: podcast.id }));
        toast(`Subscribed to ${podcast.title}`, { action: { label: "Open", onClick: () => router.push(`/podcasts/${podcast.id}`) } });
        // Home and Shows pick up the new show.
        router.refresh();
      } catch (err) {
        toast.error(errorText(err, "Couldn't subscribe to that podcast."));
      } finally {
        setBusy(null);
      }
    };

    const setDismissedOne = (feedUrl: string, on: boolean) =>
      setDismissed((d) => {
        const next = new Set(d);
        if (on) next.add(feedUrl);
        else next.delete(feedUrl);
        return next;
      });

    const notInterested = async (s: PodcastSearchResult) => {
      setDismissedOne(s.feedUrl, true);
      const send = (on: boolean) => api(apiPaths.podcastNotInterested, { method: on ? "PUT" : "DELETE", body: { feedUrl: s.feedUrl } });
      try {
        await send(true);
        toast(`You won't see ${s.title} here`, {
          duration: 5000,
          action: {
            label: "Undo",
            onClick: () => {
              setDismissedOne(s.feedUrl, false);
              send(false).catch((err: unknown) => {
                setDismissedOne(s.feedUrl, true);
                toast.error(errorText(err));
              });
            },
          },
        });
      } catch (err) {
        setDismissedOne(s.feedUrl, false);
        toast.error(errorText(err));
      }
    };

    return {
      followedId: (s) => followed[s.feedUrl] ?? s.subscribedId,
      subscribe,
      busy,
      isDismissed: (s) => dismissed.has(s.feedUrl),
      notInterested,
    };
  }, [followed, dismissed, busy, router]);

  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>;
}

const showHref = (s: PodcastSearchResult, id: string | null) => (id ? `/podcasts/${id}` : `/podcasts/preview?feed=${encodeURIComponent(s.feedUrl)}`);

/** The heart that subscribes, or the check that opens the show once you follow it. */
function SubscribeToggle({ show, className, size }: { show: PodcastSearchResult; className: string; size: number }) {
  const d = useDirectory();
  const router = useRouter();
  const id = d.followedId(show);
  if (id) {
    return (
      <button type="button" className={`${className} followed`} aria-label={`Open ${show.title}`} onClick={() => router.push(`/podcasts/${id}`)}>
        <CheckIcon size={size} />
      </button>
    );
  }
  return (
    <button type="button" className={className} aria-label={`Subscribe to ${show.title}`} disabled={d.busy !== null} onClick={() => void d.subscribe(show)}>
      <HeartIcon size={size} />
    </button>
  );
}

/** A show as a card on a shelf, with its menu on ⋯ or a right-click. */
function DirectoryCard({ show }: { show: PodcastSearchResult }) {
  const d = useDirectory();
  const router = useRouter();
  const id = d.followedId(show);
  if (d.isDismissed(show)) return null;
  return (
    <div className="card dir-card">
      <div className="card-cover">
        <Link href={showHref(show, id)} tabIndex={-1} aria-hidden="true">
          <Cover src={show.artworkUrl} color={null} title={show.title} />
        </Link>
        <SubscribeToggle show={show} className="dir-corner" size={16} />
      </div>
      <Link href={showHref(show, id)} className="card-link" title={show.title}>
        <div className="card-title">{show.title}</div>
        {show.author ? <div className="card-sub">{show.author}</div> : null}
      </Link>
      <CardMenu
        label={show.title}
        items={(choose) => (
          <>
            {id ? (
              <MenuItem onClick={choose(() => router.push(`/podcasts/${id}`))}>Open</MenuItem>
            ) : (
              <MenuItem onClick={choose(() => d.subscribe(show))}>Subscribe</MenuItem>
            )}
            <MenuItem onClick={choose(() => router.push(showHref(show, id)))}>See episodes</MenuItem>
            <MenuItem onClick={choose(() => d.notInterested(show))}>Not interested</MenuItem>
          </>
        )}
      />
    </div>
  );
}

/** A show as a list row: a rank on charts, the episode count on search results. */
function DirectoryRow({ show, rank, sub }: { show: PodcastSearchResult; rank?: number; sub?: string | null }) {
  const d = useDirectory();
  if (d.isDismissed(show)) return null;
  return (
    <div className="list-row dir-row">
      {rank !== undefined ? <span className="dir-rank">{rank}</span> : null}
      <Link href={showHref(show, d.followedId(show))} className="search-result-open">
        <Cover className="thumb" src={show.thumbUrl} color={null} title={show.title} />
        <span className="list-row-main">
          <span className="list-row-title">{show.title}</span>
          {show.author ? <span className="list-row-sub">{show.author}</span> : null}
          {sub ? <span className="list-row-sub">{sub}</span> : null}
        </span>
      </Link>
      <SubscribeToggle show={show} className="dir-heart" size={22} />
    </div>
  );
}

function DirectoryRowsSkeleton({ count, rank = false }: { count: number; rank?: boolean }) {
  return (
    <div className="list" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="list-row dir-row">
          {rank ? <span className="dir-rank" /> : null}
          <div className="skel thumb" />
          <div className="list-row-main" style={{ gap: 8 }}>
            <div className="skel skel-line" style={{ width: i % 2 ? "62%" : "78%" }} />
            <div className="skel skel-line" style={{ width: "40%", height: 10 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ShelfSkeleton() {
  return (
    <section className="section" role="status" aria-busy="true" aria-label="Loading">
      <div className="section-head">
        <div className="skel skel-line" style={{ width: 170, height: 16 }} />
      </div>
      <div className="shelf">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card">
            <div className="skel skel-cover" />
            <div className="skel skel-line" style={{ width: "80%" }} />
          </div>
        ))}
      </div>
    </section>
  );
}

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; message: string };

/** What the box shows under it: search results, or the one feed a pasted link points at. */
function BoxResults({ query }: { query: string }) {
  const link = feedLinkIn(query);
  // The results come with what they answer, so "Nothing matches" never names text still being looked up.
  const [load, setLoad] = useState<Load<{ q: string; shows: PodcastSearchResult[] }> | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!link && q.length < 2) return setLoad(null);
    let stale = false;
    // A link waits too: one typed by hand would have the server fetch every letter's address.
    const timer = setTimeout(() => {
      setLoad((l) => (l?.state === "ready" ? l : { state: "loading" }));
      const request: Promise<PodcastSearchResult[]> = link
        ? api<PodcastPreview>(apiPaths.podcastPreview(link)).then((p) => [
            { title: p.title, author: p.author, artworkUrl: p.artworkUrl, thumbUrl: p.artworkUrl, feedUrl: p.feedUrl, episodeCount: p.episodeCount, subscribedId: p.subscribedId },
          ])
        : api<PodcastSearchResult[]>(apiPaths.podcastSearch(q));
      request
        .then((shows) => !stale && setLoad({ state: "ready", data: { q, shows } }))
        .catch((err: unknown) => !stale && setLoad({ state: "error", message: link ? "That link isn't a podcast feed." : errorText(err) }));
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, link]);

  if (!load) return null;
  if (load.state === "loading") return <DirectoryRowsSkeleton count={link ? 1 : 6} />;
  if (load.state === "error") return <EmptyState>{load.message}</EmptyState>;
  if (!load.data.shows.length) return <EmptyState>{`Nothing matches "${load.data.q}".`}</EmptyState>;
  return (
    <div className="list">
      {load.data.shows.map((r) => (
        <DirectoryRow key={r.feedUrl} show={r} sub={r.episodeCount ? plural(r.episodeCount, "episode") : null} />
      ))}
    </div>
  );
}

/**
 * A show's More like tab, followed or not: the shows its feed recommends, then similar shows,
 * best first. Loads as the tab opens.
 */
export function MoreLikeList({ feedUrl }: { feedUrl: string }) {
  const [load, setLoad] = useState<Load<PodcastMoreLike>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stale = false;
    setLoad({ state: "loading" });
    api<PodcastMoreLike>(apiPaths.podcastMoreLike(feedUrl))
      .then((data) => !stale && setLoad({ state: "ready", data }))
      .catch((err: unknown) => !stale && setLoad({ state: "error", message: errorText(err) }));
    return () => {
      stale = true;
    };
  }, [feedUrl, attempt]);

  if (load.state === "loading") return <DirectoryRowsSkeleton count={8} />;
  if (load.state === "error") {
    return (
      <EmptyState title={load.message}>
        <div style={{ marginTop: 16 }}>
          <button type="button" className="btn" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </div>
      </EmptyState>
    );
  }
  const { recommended, similar } = load.data;
  if (!recommended.length && !similar.length) return <EmptyState>No similar shows found.</EmptyState>;
  const rows = (shows: PodcastSearchResult[]) => (
    <div className="list">
      {shows.map((s) => (
        <DirectoryRow key={s.feedUrl} show={s} />
      ))}
    </div>
  );
  return (
    <DirectoryProvider>
      {recommended.length ? (
        <>
          <h2 className="dir-sub">Recommended by the show</h2>
          {rows(recommended)}
          {similar.length ? <h2 className="dir-sub">Similar shows</h2> : null}
        </>
      ) : null}
      {rows(similar)}
    </DirectoryProvider>
  );
}

/**
 * More like shelves, the top shows and the categories, shown while the box is empty. Memoized, as
 * it stays mounted behind the search results and has nothing to redraw while you type.
 */
const BrowseHome = memo(function BrowseHome() {
  const router = useRouter();
  const [load, setLoad] = useState<Load<PodcastBrowse>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stale = false;
    setLoad({ state: "loading" });
    api<PodcastBrowse>(apiPaths.podcastBrowse)
      .then((data) => !stale && setLoad({ state: "ready", data }))
      .catch((err: unknown) => !stale && setLoad({ state: "error", message: errorText(err) }));
    return () => {
      stale = true;
    };
  }, [attempt]);

  if (load.state === "error") {
    return (
      <EmptyState title="Can't reach the podcast directory">
        <div>You can still paste a feed link above.</div>
        <div style={{ marginTop: 16 }}>
          <button type="button" className="btn" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </div>
      </EmptyState>
    );
  }

  return (
    <>
      {load.state === "loading" ? (
        <>
          <ShelfSkeleton />
          <section className="section">
            <div className="section-head">
              <div className="skel skel-line" style={{ width: 110, height: 16 }} />
            </div>
            <DirectoryRowsSkeleton count={BROWSE_TOP_SIZE} rank />
          </section>
        </>
      ) : (
        <div className="view-fade">
          {load.data.moreLike.map((m) => (
            <section key={m.podcastId} className="section">
              <div className="section-head">
                <SectionTitle title={`More like ${m.title}`} onOpen={() => router.push(`/podcasts/${m.podcastId}?tab=morelike`)} />
              </div>
              <ScrollRow>
                {m.shows.map((s) => (
                  <DirectoryCard key={s.feedUrl} show={s} />
                ))}
              </ScrollRow>
            </section>
          ))}
          {load.data.top.length ? (
            <section className="section">
              <div className="section-head">
                <TopShowsTitle />
              </div>
              <div className="list dir-top">
                {load.data.top.map((s, i) => (
                  <DirectoryRow key={s.feedUrl} show={s} rank={i + 1} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <SectionTitle title="Categories" />
        </div>
        <div className="dir-genres">
          {PODCAST_GENRES.map((g) => (
            <Link key={g.id} href={`/podcasts/top?genre=${g.id}`} className="dir-genre">
              {g.name}
            </Link>
          ))}
        </div>
      </section>
    </>
  );
});

function TopShowsTitle() {
  const router = useRouter();
  return <SectionTitle title="Top shows" onOpen={() => router.push("/podcasts/top")} />;
}

/** Import a list of shows from another app, or export yours. */
const OpmlButtons = memo(function OpmlButtons() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const importOpml = async (file: File) => {
    setBusy(true);
    const loading = toast("Importing. Large lists can take a minute.");
    try {
      const res = await fetch(apiPaths.podcastsOpml, { method: "POST", headers: { "Content-Type": "text/xml" }, body: await file.text() });
      const data = (await res.json()) as OpmlImportResult | { error: string };
      if (!res.ok || "error" in data) throw new Error("error" in data ? data.error : "Import failed.");
      const failed = data.failed.length ? ` ${data.failed.length} couldn't be loaded.` : "";
      const text = `Added ${plural(data.added, "podcast")}, ${data.alreadySubscribed} already followed.${failed}`;
      toast.dismiss(loading);
      if (data.failed.length) toast.error(text);
      else toast(text);
      if (data.added) router.refresh();
    } catch (err) {
      toast.dismiss(loading);
      toast.error(errorText(err, "Import failed."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dir-opml">
      <label className="btn" aria-disabled={busy || undefined}>
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
      <a className="btn" href={apiPaths.podcastsOpml} download="murmur-podcasts.opml">
        Export OPML
      </a>
    </div>
  );
});

/**
 * Top shows: the top 50 overall or in one category, picked with text tabs. The category is kept
 * in the URL, so back from a show returns to it.
 */
export function TopShowsView({ initialGenre }: { initialGenre: number | null }) {
  const [genre, setGenre] = useState(initialGenre);
  const [load, setLoad] = useState<Load<PodcastSearchResult[]>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const tabs = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stale = false;
    setLoad({ state: "loading" });
    api<PodcastSearchResult[]>(apiPaths.podcastChart(genre))
      .then((data) => !stale && setLoad({ state: "ready", data }))
      .catch((err: unknown) => !stale && setLoad({ state: "error", message: errorText(err) }));
    return () => {
      stale = true;
    };
  }, [genre, attempt]);

  // A category opened from Browse may sit off the end of the tabs.
  useEffect(() => {
    tabs.current?.querySelector<HTMLElement>("[aria-pressed=true], [aria-selected=true]")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, []);

  const pick = (g: number | null) => {
    setGenre(g);
    window.history.replaceState(null, "", g ? `/podcasts/top?genre=${g}` : "/podcasts/top");
  };

  return (
    <DirectoryProvider>
      <NestedHead title="Top shows" fallback="/podcasts?tab=browse" />
      <div ref={tabs}>
        <Chips kind="tabs" label="Category">
          <Chip selected={genre === null} onClick={() => pick(null)}>
            All
          </Chip>
          {PODCAST_GENRES.map((g) => (
            <Chip key={g.id} selected={genre === g.id} onClick={() => pick(g.id)}>
              {g.name}
            </Chip>
          ))}
        </Chips>
      </div>
      <div key={genre ?? "all"} className="view-fade">
        {load.state === "loading" ? (
          <DirectoryRowsSkeleton count={12} rank />
        ) : load.state === "error" ? (
          <EmptyState title="Can't reach the podcast directory">
            <div style={{ marginTop: 16 }}>
              <button type="button" className="btn" onClick={() => setAttempt((a) => a + 1)}>
                Try again
              </button>
            </div>
          </EmptyState>
        ) : load.data.length === 0 ? (
          <EmptyState>Nothing here right now.</EmptyState>
        ) : (
          <div className="list">
            {load.data.map((s, i) => (
              <DirectoryRow key={s.feedUrl} show={s} rank={i + 1} />
            ))}
          </div>
        )}
      </div>
    </DirectoryProvider>
  );
}

/**
 * The Browse tab. The box searches the directory or, given a feed link, shows that one feed; it
 * stays at the top while the page scrolls, and its text is kept in the URL so back from a show
 * comes back to the same results.
 */
export function BrowseView({ initialQuery, focus }: { initialQuery: string; focus: boolean }) {
  const [query, setQuery] = useState(initialQuery);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focus) input.current?.focus({ preventScroll: true });
  }, [focus]);

  // The URL follows once typing pauses, before the results show. Each write redraws the whole
  // Podcasts page (it reads the URL), and Safari refuses more than 100 writes in 30 seconds.
  useEffect(() => {
    const timer = setTimeout(() => {
      const url = new URL(window.location.href);
      if ((url.searchParams.get("q") ?? "") === query) return;
      if (query) url.searchParams.set("q", query);
      else url.searchParams.delete("q");
      window.history.replaceState(null, "", url);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const searching = query.trim().length >= 2 || feedLinkIn(query) !== null;

  return (
    <DirectoryProvider>
      <form className="search-bar dir-search" role="search" onSubmit={(e) => (e.preventDefault(), input.current?.blur())}>
        <label className="search-field">
          <SearchIcon size={20} />
          <input
            ref={input}
            type="search"
            enterKeyHint="search"
            aria-label="Search podcasts or paste a feed link"
            placeholder="Search podcasts or paste a feed link"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button type="button" className="icon-btn" aria-label="Clear" onClick={() => (setQuery(""), input.current?.focus())}>
              <CloseIcon size={18} />
            </button>
          ) : null}
        </label>
      </form>
      {searching ? (
        <div className="view-fade">
          <BoxResults query={query} />
        </div>
      ) : null}
      {/* Kept while searching, so clearing the box brings the shelves back as they were. */}
      <div hidden={searching}>
        <BrowseHome />
        <OpmlButtons />
      </div>
    </DirectoryProvider>
  );
}
