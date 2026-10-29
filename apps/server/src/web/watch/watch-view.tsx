"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  errorText,
  type HealthDto,
  type MovieSummary,
  percentDone,
  type ShowSummary,
  sortWatch,
  WATCH_SORT_KEY,
  WATCH_SORTS,
  type WatchHomeDto,
  type WatchSort,
} from "@murmur/shared/client";
import { api } from "../api";
import { CloseIcon, FilterIcon, RefreshIcon, SearchIcon } from "../icons";
import { Sheet, SheetItem } from "../sheet";
import { Chip, Chips, EmptyState, ScrollRow, SearchBox, SectionTitle } from "../ui";
import { PosterCard, StillCard } from "./cards";

export type WatchTab = "home" | "movies" | "shows" | "watched";
const TABS: Array<{ id: WatchTab; label: string }> = [
  { id: "home", label: "Home" },
  { id: "movies", label: "Movies" },
  { id: "shows", label: "Shows" },
  { id: "watched", label: "Watched" },
];

type Item = { kind: "movie"; m: MovieSummary } | { kind: "show"; s: ShowSummary };

const titleOf = (i: Item) => (i.kind === "movie" ? i.m.title : i.s.title);
const summaryOf = (i: Item) => (i.kind === "movie" ? i.m : i.s);

/** The Movies, Shows and Watched sort, kept in this browser. */
function useWatchSort(): [WatchSort, (s: WatchSort) => void] {
  const [sort, setSort] = useState<WatchSort>("added");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(WATCH_SORT_KEY) as WatchSort | null;
      if (saved && WATCH_SORTS.some((s) => s.id === saved)) setSort(saved);
    } catch {
      // private mode
    }
  }, []);
  const save = (next: WatchSort) => {
    setSort(next);
    try {
      localStorage.setItem(WATCH_SORT_KEY, next);
    } catch {
      // private mode
    }
  };
  return [sort, save];
}
const watchedOf = (i: Item) => (i.kind === "movie" ? !!i.m.progress?.finished : i.s.episodes > 0 && i.s.watched === i.s.episodes);

function ItemCard({ item }: { item: Item }) {
  if (item.kind === "show") {
    const s = item.s;
    return <PosterCard kind="show" id={s.id} title={s.title} year={s.year} posterHash={s.posterHash} color={s.color} watched={watchedOf(item)} />;
  }
  const m = item.m;
  const partway = m.progress && !m.progress.finished ? percentDone(m.progress.positionSec, m.durationSec) : 0;
  return (
    <PosterCard kind="movie" id={m.id} title={m.title} year={m.year} posterHash={m.posterHash} color={m.color} watched={watchedOf(item)} percent={partway} />
  );
}

function PosterGrid({ items }: { items: Item[] }) {
  return (
    <div className="grid">
      {items.map((i) => (
        <ItemCard key={`${i.kind}-${i.kind === "movie" ? i.m.id : i.s.id}`} item={i} />
      ))}
    </div>
  );
}

const SCAN_POLL_MS = 2000;

/** Admins: rescans the movies and shows folders (and matches what's new), spinning until it's done. */
function RescanButton() {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const rescan = async () => {
    setScanning(true);
    try {
      await api("/api/watch/scan", { method: "POST" });
      // The scan runs in the background; health says when it's finished.
      for (;;) {
        await new Promise((r) => setTimeout(r, SCAN_POLL_MS));
        const health = await api<HealthDto>("/api/health");
        if (!health.watch?.scan.running) break;
      }
      router.refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setScanning(false);
    }
  };
  return (
    <button
      type="button"
      className={`icon-btn ${scanning ? "spinning" : ""}`}
      aria-label={scanning ? "Scanning" : "Rescan movies and shows"}
      disabled={scanning}
      onClick={rescan}
    >
      <RefreshIcon />
    </button>
  );
}

/** One sideways row of posters, like the book shelves. */
function PosterShelf({ items }: { items: Item[] }) {
  return (
    <ScrollRow>
      {items.map((i) => (
        <ItemCard key={`${i.kind}-${i.kind === "movie" ? i.m.id : i.s.id}`} item={i} />
      ))}
    </ScrollRow>
  );
}

/** The Watch tab: Continue watching, Next episodes, and recently added movies and shows, then movies, shows and what you've watched. */
export function WatchView({
  home,
  movies,
  shows,
  isAdmin,
}: {
  home: WatchHomeDto;
  movies: MovieSummary[];
  shows: ShowSummary[];
  isAdmin: boolean;
}) {
  const params = useSearchParams();
  const tab = TABS.find((t) => t.id === params.get("tab"))?.id ?? "home";
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useWatchSort();
  const [sortOpen, setSortOpen] = useState(false);
  // Same as the library tabs: no server round trip, and Next keeps useSearchParams in step.
  const show = (next: WatchTab) => window.history.pushState(null, "", next === "home" ? "/watch" : `/watch?tab=${next}`);

  const all = sortWatch<Item>([...movies.map((m) => ({ kind: "movie" as const, m })), ...shows.map((s) => ({ kind: "show" as const, s }))], sort, summaryOf);
  const q = query.trim().toLowerCase();
  const byTab: Record<Exclude<WatchTab, "home">, Item[]> = {
    movies: all.filter((i) => i.kind === "movie"),
    shows: all.filter((i) => i.kind === "show"),
    watched: all.filter(watchedOf),
  };
  const searched = q ? (tab === "home" ? all : byTab[tab]).filter((i) => titleOf(i).toLowerCase().includes(q)) : null;
  const recent: Item[] = home.recentlyAdded.flatMap((p): Item[] => {
    if (p.kind === "movie") {
      const m = movies.find((x) => x.id === p.id);
      return m ? [{ kind: "movie", m }] : [];
    }
    const s = shows.find((x) => x.id === p.id);
    return s ? [{ kind: "show", s }] : [];
  });
  const recentMovies = recent.filter((i) => i.kind === "movie");
  const recentShows = recent.filter((i) => i.kind === "show");

  // No movies or shows folder set up yet.
  if (!home.enabled) {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">Watch</h1>
        </div>
        <EmptyState title="Nothing to watch yet">
          {isAdmin ? "Add a movies or shows folder and they show up here." : "Movies and shows show up here once a folder is added."}
          {isAdmin ? (
            <Link href="/you/library" className="btn btn-primary" style={{ marginTop: 12 }}>
              Add a folder
            </Link>
          ) : null}
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Watch</h1>
        <div className="head-actions">
          {isAdmin ? <RescanButton /> : null}
          <button
            type="button"
            className="icon-btn"
            aria-label={searching ? "Close search" : "Search"}
            onClick={() => {
              setSearching((s) => !s);
              setQuery("");
            }}
          >
            {searching ? <CloseIcon /> : <SearchIcon />}
          </button>
          {tab !== "home" ? (
            <button type="button" className="icon-btn" aria-label="Sort" onClick={() => setSortOpen(true)}>
              <FilterIcon />
            </button>
          ) : null}
        </div>
      </div>
      <Sheet open={sortOpen} onClose={() => setSortOpen(false)} title="Sort">
        {WATCH_SORTS.map((s) => (
          <SheetItem
            key={s.id}
            active={sort === s.id}
            onClick={() => {
              setSort(s.id);
              setSortOpen(false);
            }}
          >
            {s.label}
          </SheetItem>
        ))}
      </Sheet>
      {searching ? <SearchBox value={query} onChange={setQuery} placeholder="Search movies and shows" label="Search movies and shows" /> : null}
      <Chips kind="tabs" label="Watch">
        {TABS.map((t) => (
          <Chip key={t.id} selected={tab === t.id} onClick={() => show(t.id)}>
            {t.label}
          </Chip>
        ))}
      </Chips>

      {all.length === 0 ? (
        <EmptyState title="Nothing to watch yet">Movies and shows show up here once the scan finds them.</EmptyState>
      ) : searched ? (
        searched.length ? (
          <section className="section">
            <PosterGrid items={searched} />
          </section>
        ) : (
          <EmptyState>Nothing matches &quot;{query.trim()}&quot;.</EmptyState>
        )
      ) : tab === "home" ? (
        <>
          {home.continueWatching.length ? (
            <section className="section">
              <SectionTitle title="Continue watching" />
              <ScrollRow className="row-scroll">
                {home.continueWatching.map((c) => (
                  <StillCard key={c.id} card={c} />
                ))}
              </ScrollRow>
            </section>
          ) : null}
          {home.nextEpisodes.length ? (
            <section className="section">
              <SectionTitle title="Next episodes" />
              <ScrollRow className="row-scroll">
                {home.nextEpisodes.map((c) => (
                  <StillCard key={c.id} card={c} />
                ))}
              </ScrollRow>
            </section>
          ) : null}
          {recentMovies.length ? (
            <section className="section">
              <SectionTitle title="Recently added movies" />
              <PosterShelf items={recentMovies} />
            </section>
          ) : null}
          {recentShows.length ? (
            <section className="section">
              <SectionTitle title="Recently added shows" />
              <PosterShelf items={recentShows} />
            </section>
          ) : null}
        </>
      ) : byTab[tab].length ? (
        <section className="section">
          <PosterGrid items={byTab[tab]} />
        </section>
      ) : tab === "watched" ? (
        <EmptyState title="Nothing watched yet">Movies you finish, and shows you've seen every episode of, go here.</EmptyState>
      ) : (
        <EmptyState title={tab === "movies" ? "No movies yet" : "No shows yet"}>They show up here once the scan finds them.</EmptyState>
      )}
    </>
  );
}
