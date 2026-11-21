"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiPaths, hasKind, parseRecent, plural, storageKeys, withRecent, type SearchKind, type SearchName, type SearchResultsDto, type UserPrefs } from "@murmur/shared/client";
import { api } from "../api";
import { BookActions } from "../book/book-actions";
import { HIDDEN_CHANGED } from "../hidden";
import { CloseIcon, SearchIcon } from "../icons";
import { BookCard } from "../library/book-card";
import { AlbumCard, ArtistCard } from "../music/music-view";
import { SongRow } from "../music/song-row";
import { EpisodeRow } from "../podcasts/episode-row";
import { usePlayerControls } from "../player/engine";
import { PodcastCard } from "../podcasts/podcasts-view";
import { Chip, Chips, EmptyState, ScrollRow, SectionTitle, StickyHead } from "../ui";
import { PosterCard, StillCard } from "../watch/cards";

const KINDS: Array<{ id: SearchKind; label: string }> = [
  { id: "all", label: "All" },
  { id: "books", label: "Books" },
  { id: "podcasts", label: "Podcasts" },
  { id: "music", label: "Music" },
  { id: "watch", label: "Watch" },
];

// ---------- Recent searches, kept in this browser ----------

function readRecent(): string[] {
  try {
    return parseRecent(JSON.parse(localStorage.getItem(storageKeys.recentSearches) ?? "[]"));
  } catch {
    return [];
  }
}

function writeRecent(list: string[]) {
  try {
    localStorage.setItem(storageKeys.recentSearches, JSON.stringify(list));
  } catch {
    // Private windows and blocked storage: recent searches just aren't kept.
  }
}

/** Search everywhere: one box for books, podcasts, music and Watch, with a tab per kind. */
export function SearchView({ tabs }: { tabs: UserPrefs["tabs"] }) {
  const params = useSearchParams();
  const kinds = KINDS.filter(
    (k) =>
      k.id === "all" ||
      (k.id === "books" && tabs.books !== false) ||
      (k.id === "podcasts" && tabs.podcasts) ||
      (k.id === "music" && tabs.music) ||
      (k.id === "watch" && tabs.watch),
  );
  const startKind = params.get("kind") as SearchKind | null;
  // Back from a result comes back with the search in the address.
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [kind, setKind] = useState<SearchKind>(kinds.some((k) => k.id === startKind) ? startKind! : "all");
  const [results, setResults] = useState<SearchResultsDto | null>(null);
  const [allResults, setAllResults] = useState<SearchResultsDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const q = query.trim();
  // Hiding something from a result asks again, so it leaves the results.
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const again = () => setReload((n) => n + 1);
    window.addEventListener(HIDDEN_CHANGED, again);
    return () => window.removeEventListener(HIDDEN_CHANGED, again);
  }, []);

  useEffect(() => {
    setRecent(readRecent());
    // Opened with nothing typed: ready to type.
    if (!input.current?.value) input.current?.focus({ preventScroll: true });
  }, []);

  // The address keeps the search, so Back from a result comes back to it.
  useEffect(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (kind !== "all") p.set("kind", kind);
    const qs = p.toString();
    window.history.replaceState(window.history.state, "", qs ? `/search?${qs}` : "/search");
  }, [q, kind]);

  // Asks once typing pauses; an answer for an older search is dropped. All always comes too,
  // as it says which kinds have anything and so which tabs show.
  useEffect(() => {
    if (!q) {
      setResults(null);
      setAllResults(null);
      setFailed(false);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      const ask = (k: SearchKind) => api<SearchResultsDto>(apiPaths.search(q, k));
      Promise.all([ask("all"), kind === "all" ? null : ask(kind)]).then(
        ([everything, ofKind]) => {
          if (stale) return;
          setAllResults(everything);
          setResults(ofKind ?? everything);
          setFailed(false);
        },
        () => {
          if (!stale) setFailed(true);
        },
      );
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [q, kind, reload]);

  // Tabs only for kinds with matches, and none unless two kinds have some (All would say the same).
  // While the next answer comes, the last one's tabs stay, so they don't blink out at each key.
  const found = allResults ? kinds.filter((k) => k.id !== "all" && hasKind(allResults, k.id)) : [];
  const shownKinds = found.length > 1 ? [kinds[0]!, ...found] : [];
  // A tab whose kind has nothing for this search goes back to All.
  const fresh = allResults?.q === q;
  const kindFound = found.some((k) => k.id === kind);
  const kindEmpty = fresh && kind !== "all" && !kindFound;
  useEffect(() => {
    if (!kindEmpty) return;
    setKind("all");
    // All's answer is already here, so it shows while All is asked for again.
    setResults(allResults);
  }, [kindEmpty, allResults]);
  // Until then, All's answer shows, rather than the old tab's empty one.
  const shown = kindEmpty ? allResults : results;
  const shownKind = kindEmpty ? "all" : kind;

  const remember = (term: string) => {
    if (!term.trim()) return;
    const next = withRecent(recent, term);
    setRecent(next);
    writeRecent(next);
  };
  const forget = (term: string) => {
    const next = recent.filter((r) => r !== term);
    setRecent(next);
    writeRecent(next);
  };

  return (
    <>
      <StickyHead>
      <div className="page-head">
        <h1 className="page-title">Search</h1>
      </div>
      <form
        className="search-bar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          remember(q);
          input.current?.blur();
        }}
      >
        <label className="search-field">
          <SearchIcon size={20} />
          <input
            ref={input}
            type="search"
            enterKeyHint="search"
            aria-label="Search"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="icon-btn"
              aria-label="Clear"
              onClick={() => {
                setQuery("");
                input.current?.focus();
              }}
            >
              <CloseIcon size={20} />
            </button>
          ) : null}
        </label>
      </form>

      {q && shownKinds.length ? (
        <Chips kind="tabs" label="Search in">
          {shownKinds.map((k) => (
            <Chip key={k.id} selected={kind === k.id} onClick={() => setKind(k.id)}>
              {k.label}
            </Chip>
          ))}
        </Chips>
      ) : null}
      </StickyHead>

      {!q ? (
        <RecentSearches recent={recent} onPick={setQuery} onForget={forget} />
      ) : failed && !shown ? (
        <EmptyState>Couldn&apos;t search the server.</EmptyState>
      ) : shown ? (
        // Clicking through to a result keeps the search among the recent ones.
        <div key={`${shown.q}|${shownKind}`} onClickCapture={(e) => (e.target as HTMLElement).closest("a, button") && remember(q)}>
          <Results results={shown} kind={shownKind} onKind={setKind} />
        </div>
      ) : null}
    </>
  );
}

function RecentSearches({ recent, onPick, onForget }: { recent: string[]; onPick: (q: string) => void; onForget: (q: string) => void }) {
  if (!recent.length) return null;
  return (
    <section className="section">
      <SectionTitle title="Recent" />
      <div className="list">
        {recent.map((r) => (
          <div key={r} className="list-row recent-row">
            <button type="button" className="list-row-play" onClick={() => onPick(r)}>
              <SearchIcon size={20} />
              <span className="list-row-title">{r}</span>
            </button>
            <button type="button" className="icon-btn" aria-label={`Remove ${r}`} onClick={() => onForget(r)}>
              <CloseIcon size={20} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

const isEmpty = (r: SearchResultsDto) => !hasKind(r, "all");

/**
 * A group's cards: a shelf on All, a grid on a kind's tab. Defined here, not inside Results: a
 * component made in render is new each time, so every card would remount and close its menu.
 */
function Cards({ all, children }: { all: boolean; children: React.ReactNode }) {
  return all ? <ScrollRow>{children}</ScrollRow> : <div className="grid">{children}</div>;
}

/** On All, a shelf per group with a heading that opens its kind's tab; on a kind's tab, the full grids and lists. */
function Results({ results: r, kind, onKind }: { results: SearchResultsDto; kind: SearchKind; onKind: (k: SearchKind) => void }) {
  const player = usePlayerControls();
  if (isEmpty(r)) return <EmptyState>{`Nothing matches "${r.q}".`}</EmptyState>;
  const all = kind === "all";
  // A song plays every song found, in this order, even past the four All shows.
  const songs = all ? r.songs.slice(0, 4) : r.songs;
  const open = (k: SearchKind) => (all ? () => onKind(k) : undefined);
  return (
    <>
      <Group title="Books" show={r.books.length > 0} onOpen={open("books")}>
        {/* Book cards here open their menu like everywhere else. */}
        <BookActions>
          <Cards all={all}>
            {r.books.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </Cards>
        </BookActions>
      </Group>
      <Group title="Authors" show={r.authors.length > 0} onOpen={open("books")}>
        <NameRows names={r.authors} href={(n) => `/?author=${encodeURIComponent(n)}`} />
      </Group>
      <Group title="Series" show={r.series.length > 0} onOpen={open("books")}>
        <NameRows names={r.series} href={(n) => `/?series=${encodeURIComponent(n)}`} />
      </Group>
      <Group title="Podcasts" show={r.podcasts.length > 0} onOpen={open("podcasts")}>
        <Cards all={all}>
          {r.podcasts.map((p) => (
            <PodcastCard key={p.id} podcast={p} />
          ))}
        </Cards>
      </Group>
      <Group title="Episodes" show={r.episodes.length > 0} onOpen={open("podcasts")}>
        <div className="list">
          {(all ? r.episodes.slice(0, 4) : r.episodes).map((e) => (
            <EpisodeRow key={e.id} episode={e} showThumb />
          ))}
        </div>
      </Group>
      <Group title="Artists" show={r.artists.length > 0} onOpen={open("music")}>
        <Cards all={all}>
          {r.artists.map((a) => (
            <ArtistCard key={a.id} artist={a} />
          ))}
        </Cards>
      </Group>
      <Group title="Albums" show={r.albums.length > 0} onOpen={open("music")}>
        <Cards all={all}>
          {r.albums.map((a) => (
            <AlbumCard key={a.id} album={a} />
          ))}
        </Cards>
      </Group>
      <Group title="Songs" show={r.songs.length > 0} onOpen={open("music")}>
        <div className="list">
          {songs.map((t, i) => (
            <SongRow key={t.id} track={t} onPlay={() => player.playMusic({ kind: "songs", refId: null, title: `"${r.q}"`, tracks: r.songs }, i)} />
          ))}
        </div>
      </Group>
      <Group title="Movies and shows" show={r.watch.length > 0} onOpen={open("watch")}>
        <Cards all={all}>
          {r.watch.map((p) => (
            <PosterCard key={`${p.kind}-${p.id}`} kind={p.kind} id={p.id} title={p.title} year={p.year} posterHash={p.posterHash} color={p.color} watched={p.watched} />
          ))}
        </Cards>
      </Group>
      <Group title="TV episodes" show={r.tvEpisodes.length > 0} onOpen={open("watch")}>
        <ScrollRow>
          {r.tvEpisodes.map((c) => (
            <StillCard key={c.id} card={c} />
          ))}
        </ScrollRow>
      </Group>
    </>
  );
}

function Group({ title, show, onOpen, children }: { title: string; show: boolean; onOpen?: () => void; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <section className="section">
      <SectionTitle title={title} onOpen={onOpen} />
      {children}
    </section>
  );
}

function NameRows({ names, href }: { names: SearchName[]; href: (name: string) => string }) {
  return (
    <div className="list">
      {names.map((n) => (
        <Link key={n.name} href={href(n.name)} className="list-row list-row-link">
          <span className="list-row-main">
            <span className="list-row-title">{n.name}</span>
            <span className="list-row-sub">{plural(n.books, "book")}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
