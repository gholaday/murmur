"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  type MovieSummary,
  percentDone,
  type ShowSummary,
  sortWatch,
  storageKeys,
  WATCH_SORTS,
  type WatchHomeDto,
  type WatchPoster,
  type WatchSort,
} from "@murmur/shared/client";
import { FilterIcon } from "../icons";
import { ChoiceSheet } from "../sheet";
import { Chip, Chips, EmptyState, ScrollRow, SectionTitle, useSavedChoice } from "../ui";
import { PosterCard, StillCard } from "./cards";

type WatchTab = "home" | "movies" | "shows" | "watched";
const TABS: Array<{ id: WatchTab; label: string }> = [
  { id: "home", label: "Home" },
  { id: "movies", label: "Movies" },
  { id: "shows", label: "Shows" },
  { id: "watched", label: "Watched" },
];

type Item = { kind: "movie"; m: MovieSummary } | { kind: "show"; s: ShowSummary };

const summaryOf = (i: Item) => (i.kind === "movie" ? i.m : i.s);

/** The Movies, Shows and Watched sort, kept in this browser. */
const useWatchSort = () => useSavedChoice<WatchSort>(storageKeys.watchSort, "added", WATCH_SORTS);
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
  const [sort, setSort] = useWatchSort();
  const [sortOpen, setSortOpen] = useState(false);
  // Same as the library tabs: no server round trip, and Next keeps useSearchParams in step.
  const show = (next: WatchTab) => window.history.pushState(null, "", next === "home" ? "/watch" : `/watch?tab=${next}`);

  const all = sortWatch<Item>([...movies.map((m) => ({ kind: "movie" as const, m })), ...shows.map((s) => ({ kind: "show" as const, s }))], sort, summaryOf);
  const byTab: Record<Exclude<WatchTab, "home">, Item[]> = {
    movies: all.filter((i) => i.kind === "movie"),
    shows: all.filter((i) => i.kind === "show"),
    watched: all.filter(watchedOf),
  };
  const toItems = (posters: WatchPoster[]): Item[] =>
    posters.flatMap((p): Item[] => {
      if (p.kind === "movie") {
        const m = movies.find((x) => x.id === p.id);
        return m ? [{ kind: "movie", m }] : [];
      }
      const s = shows.find((x) => x.id === p.id);
      return s ? [{ kind: "show", s }] : [];
    });
  const recent = toItems(home.recentlyAdded);
  // Older servers don't send these; a shelf the server couldn't build comes back empty.
  const nextInCollection = toItems(home.nextInCollection ?? []);
  const moreLike = home.moreLike ? { title: home.moreLike.title, items: toItems(home.moreLike.items) } : null;
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
          {isAdmin ? "Mount your movies at /movies and shows at /shows, and they show up here." : "Movies and shows show up here once they're added."}
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Watch</h1>
        <div className="head-actions">
          {tab !== "home" ? (
            <button type="button" className="icon-btn" aria-label={`Sort, ${WATCH_SORTS.find((s) => s.id === sort)?.label}`} onClick={() => setSortOpen(true)}>
              <FilterIcon />
            </button>
          ) : null}
        </div>
      </div>
      <ChoiceSheet open={sortOpen} onClose={() => setSortOpen(false)} title="Sort" choices={WATCH_SORTS} value={sort} onPick={setSort} />
      <Chips kind="tabs" label="Watch">
        {TABS.map((t) => (
          <Chip key={t.id} selected={tab === t.id} onClick={() => show(t.id)}>
            {t.label}
          </Chip>
        ))}
      </Chips>

      <div key={tab} className="view-fade">
      {all.length === 0 ? (
        <EmptyState title="Nothing to watch yet">Movies and shows show up here once the scan finds them.</EmptyState>
      ) : tab === "home" ? (
        <>
          {!home.continueWatching.length && !home.nextEpisodes.length && !nextInCollection.length && !moreLike?.items.length && !recentMovies.length && !recentShows.length ? (
            <EmptyState>Nothing here yet.</EmptyState>
          ) : null}
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
          {nextInCollection.length ? (
            <section className="section">
              <SectionTitle title="Next in the collection" />
              <PosterShelf items={nextInCollection} />
            </section>
          ) : null}
          {moreLike?.items.length ? (
            <section className="section">
              <SectionTitle title={moreLike.title} />
              <PosterShelf items={moreLike.items} />
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
      </div>
    </>
  );
}
