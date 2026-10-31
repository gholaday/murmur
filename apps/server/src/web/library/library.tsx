"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  apiPaths,
  BOOK_SECTION_TITLES,
  type BookSection,
  type BookSectionId,
  type BookSummary,
  bySeriesOrder,
  continueListening,
  groupBy,
  matchesBook,
  seriesLabel,
  SHELF_SIZE,
  SHELF_TITLES,
  shelfBooks,
  type ShelfId,
  sortBooks,
  BOOK_SORTS,
  type BookSort as Sort,
  LIBRARY_SORT_KEY,
  progressPct,
  shelfSub,
  shelfTitle,
  timeLeft,
} from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { Mixer } from "../mixer";
import { useNowPlaying } from "../player/engine";
import { CustomizeIcon, DragIcon, FilterIcon, SearchIcon } from "../icons";
import { EditBookDialog, type EditTab } from "../book/edit-dialog";
import { Sheet, SheetItem } from "../sheet";
import { useSortable } from "../sortable";
import { Chip, Chips, EmptyState, NestedHead, ScrollRow, SearchBox, SectionTitle } from "../ui";
import { BookActionsContext, BookCard } from "./book-card";
import { PlayNextList } from "./play-next-list";

type Tab = "books" | "authors" | "series" | "finished";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "books", label: "Books" },
  { id: "authors", label: "Authors" },
  { id: "series", label: "Series" },
  { id: "finished", label: "Finished" },
];

/** A titled row of cards, like an author on Books or an artist on Music: the heading opens it. */
export function GroupGrid({
  title,
  noun = "book",
  count,
  sub,
  side,
  onOpen,
  children,
}: {
  title: string;
  /** What the count counts. */
  noun?: string;
  count: number;
  sub?: string | null;
  side?: string | null;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <div className="group-head">
          <SectionTitle title={title} count={count} noun={noun} onOpen={onOpen} />
          {sub ? <span className="muted small">{sub}</span> : null}
        </div>
        {side ? <span className="muted small">{side}</span> : null}
      </div>
      <ScrollRow>{children}</ScrollRow>
    </section>
  );
}

interface LibraryProps {
  books: BookSummary[];
  emptyReason: string;
  isAdmin: boolean;
  /** The server's date (YYYY-MM-DD), which seeds the daily Not started shuffle. */
  today: string;
  /** Your Books tab layout: section order and which are hidden. */
  sections: BookSection[];
}

export function Library(props: LibraryProps) {
  return (
    <BookActions isAdmin={props.isAdmin}>
      <LibraryView {...props} />
    </BookActions>
  );
}

/** Book cards' menu actions, with the Edit dialog they open for admins. */
export function BookActions({ isAdmin, children }: { isAdmin: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string; tab: EditTab } | null>(null);
  const actions = useMemo(() => ({ isAdmin, edit: (id: string, tab: EditTab) => setEditing({ id, tab }) }), [isAdmin]);
  return (
    <BookActionsContext.Provider value={actions}>
      {children}
      {isAdmin && editing ? (
        <EditBookDialog
          key={`${editing.id}:${editing.tab}`}
          bookId={editing.id}
          tab={editing.tab}
          open
          onClose={() => setEditing(null)}
          onChanged={() => router.refresh()}
        />
      ) : null}
    </BookActionsContext.Provider>
  );
}

/** A shelf's books; one whose rule fails comes back empty and hides, so the rest of the tab still shows. */
function safeShelf(id: ShelfId, books: BookSummary[], day: string): BookSummary[] {
  try {
    return shelfBooks(id, books, day);
  } catch (err) {
    console.warn(`The ${id} shelf couldn't be built`, err);
    return [];
  }
}

function LibraryView({ books, emptyReason, isAdmin, today: serverToday, sections: savedSections }: LibraryProps) {
  // The shelves' daily shuffle follows this device's day, like the app; the server's only fills
  // the first render.
  const [today, setToday] = useState(serverToday);
  useEffect(() => setToday(new Date().toLocaleDateString("en-CA")), []);
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "books";
  const author = params.get("author");
  const series = params.get("series");
  const shelfParam = params.get("shelf");
  const shelf = shelfParam && shelfParam in SHELF_TITLES ? (shelfParam as ShelfId) : null;
  const allBooks = shelfParam === "all";
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [sort, setSort] = useState<Sort>("added");
  const [sortOpen, setSortOpen] = useState(false);
  const [sections, setSections] = useState(savedSections);
  const [customizing, setCustomizing] = useState(false);

  // Shown at once; put back if the server doesn't take it.
  const saveSections = (next: BookSection[]) => {
    const previous = sections;
    setSections(next);
    api(apiPaths.prefs, { method: "PUT", body: { bookSections: next } }).catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Couldn't save the layout.");
      setSections(previous);
    });
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LIBRARY_SORT_KEY) as Sort | null;
      if (saved && BOOK_SORTS.some((s) => s.id === saved)) setSort(saved);
    } catch {
      // private mode
    }
  }, []);

  const go = (next: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const qs = p.toString();
    // Every view is built from the books already here, so skip the server round trip
    // (and its loading placeholder); Next keeps useSearchParams in step with pushState.
    window.history.pushState(null, "", qs ? `${pathname}?${qs}` : pathname);
    // A shelf, author or series opens like a new page, at the top. Tab switches stay put.
    if (next.shelf || next.author || next.series) window.scrollTo(0, 0);
  };

  const continuing = useMemo(() => continueListening(books), [books]);
  const shelves = useMemo(
    () => ({
      playnext: shelfBooks("playnext", books, today),
      next: shelfBooks("next", books, today),
      like: safeShelf("like", books, today),
      short: safeShelf("short", books, today),
      added: shelfBooks("added", books, today),
      unstarted: shelfBooks("unstarted", books, today),
    }),
    [books, today],
  );
  const likeTitle = useMemo(() => {
    try {
      return shelfTitle("like", books);
    } catch {
      return SHELF_TITLES.like;
    }
  }, [books]);
  const titleOf = (id: BookSectionId) => (id === "like" ? likeTitle : BOOK_SECTION_TITLES[id]);
  // The Authors and Series tabs, grouped once per book list rather than on every render.
  const byAuthor = useMemo(() => groupBy(books, (b) => b.author).map(([name, items]) => ({ name, items: sortBooks(items, "author") })), [books]);
  const bySeries = useMemo(
    () => groupBy(books, (b) => b.series).map(([name, items]) => ({ name, items, ordered: [...items].sort(bySeriesOrder) })),
    [books],
  );
  const counts: Record<BookSectionId, number> = {
    continue: continuing.length,
    playnext: shelves.playnext.length,
    next: shelves.next.length,
    like: shelves.like.length,
    short: shelves.short.length,
    added: shelves.added.length,
    unstarted: shelves.unstarted.length,
    all: books.length,
  };
  const sorted = useMemo(() => sortBooks(books, sort), [books, sort]);
  const q = query.trim().toLowerCase();

  const sortSheet = (
    <Sheet open={sortOpen} onClose={() => setSortOpen(false)} title="Sort books">
      {BOOK_SORTS.map((s) => (
        <SheetItem
          key={s.id}
          active={sort === s.id}
          onClick={() => {
            setSort(s.id);
            setSortOpen(false);
            try {
              localStorage.setItem(LIBRARY_SORT_KEY, s.id);
            } catch {
              // private mode
            }
          }}
        >
          {s.label}
        </SheetItem>
      ))}
    </Sheet>
  );

  if (books.length === 0) {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">Books</h1>
        </div>
        <EmptyState title="No books yet">{emptyReason}</EmptyState>
      </>
    );
  }

  // Every book, opened from the All books heading, in the chosen sort.
  if (allBooks) {
    return (
      <>
        <NestedHead
          title={BOOK_SECTION_TITLES.all}
          count={sorted.length}
          actions={
            <button type="button" className="icon-btn" aria-label="Sort" onClick={() => setSortOpen(true)}>
              <FilterIcon />
            </button>
          }
        />
        <div className="grid">
          {sorted.map((b) => (
            <BookCard key={b.id} book={b} />
          ))}
        </div>
        {sortSheet}
      </>
    );
  }

  // A shelf's full list, opened from its heading.
  if (shelf === "playnext") return <PlayNextList books={shelves.playnext} />;
  if (shelf) {
    const list = safeShelf(shelf, books, today);
    return (
      <>
        <NestedHead title={titleOf(shelf)} count={list.length} />
        {list.length ? (
          <div className="grid">
            {list.map((b) => (
              <BookCard key={b.id} book={b} sub={shelfSub(shelf, b)} />
            ))}
          </div>
        ) : (
          <EmptyState>Nothing here right now.</EmptyState>
        )}
      </>
    );
  }

  // Drill-down views: one author or one series.
  if (author || series) {
    const list = books.filter((b) => (author ? b.author === author : b.series === series));
    const groups = author ? groupBy(list, (b) => b.series ?? "") : [];
    const standalone = author ? list.filter((b) => !b.series) : [];
    return (
      <>
        <NestedHead title={author ?? series ?? ""} count={list.length} sub={series ? list[0]?.author : null} />
        {series ? (
          <div className="grid">
            {[...list].sort(bySeriesOrder).map((b) => (
              <BookCard key={b.id} book={b} sub={b.seriesPosition !== null ? `Book ${b.seriesPosition}` : b.author} />
            ))}
          </div>
        ) : (
          <>
            {groups.map(([name, items]) => (
              <section key={name} className="section">
                <div className="section-head">
                  <SectionTitle title={name} count={items.length} noun="book" onOpen={() => go({ series: name })} />
                </div>
                <ScrollRow>
                  {[...items].sort(bySeriesOrder).map((b) => (
                    <BookCard key={b.id} book={b} sub={b.seriesPosition !== null ? `Book ${b.seriesPosition}` : null} />
                  ))}
                </ScrollRow>
              </section>
            ))}
            {standalone.length ? (
              <section className="section">
                {groups.length ? <h2 className="section-title">Standalone</h2> : null}
                <ScrollRow>
                  {sortBooks(standalone, "title").map((b) => (
                    <BookCard key={b.id} book={b} sub={null} />
                  ))}
                </ScrollRow>
              </section>
            ) : null}
          </>
        )}
      </>
    );
  }

  /** A Books tab section's cards, or null when it has none. */
  const sectionBody = (id: BookSectionId): React.ReactNode => {
    if (id === "continue") {
      return continuing.length ? (
        <ScrollRow className="row-scroll">
          {continuing.slice(0, SHELF_SIZE).map((b) => (
            <ContinueCard key={b.id} book={b} />
          ))}
        </ScrollRow>
      ) : null;
    }
    const list = id === "all" ? sorted : shelves[id];
    return list.length ? (
      <ScrollRow>
        {list.slice(0, SHELF_SIZE).map((b) => (
          <BookCard key={b.id} book={b} sub={id === "all" ? undefined : shelfSub(id, b)} />
        ))}
      </ScrollRow>
    ) : null;
  };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Books</h1>
        <div className="head-actions">
          {tab === "books" ? (
            <button
              type="button"
              className={`icon-btn ${customizing ? "accent" : ""}`}
              aria-label={customizing ? "Done customizing" : "Customize"}
              aria-pressed={customizing}
              onClick={() => {
                setCustomizing((c) => !c);
                setSearching(false);
                setQuery("");
              }}
            >
              <CustomizeIcon />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            aria-label="Search"
            aria-pressed={searching}
            onClick={() => {
              setSearching((s) => !s);
              setQuery("");
              setCustomizing(false);
            }}
          >
            <SearchIcon />
          </button>
          <button type="button" className="icon-btn" aria-label="Sort" onClick={() => setSortOpen(true)}>
            <FilterIcon />
          </button>
        </div>
      </div>

      {searching ? (
        <SearchBox value={query} onChange={setQuery} placeholder="Title, author, narrator or series" label="Search library" />
      ) : null}

      {q ? (
        <SearchResults books={sorted.filter((b) => matchesBook(b, q))} query={query} />
      ) : (
        <>
          <Chips kind="tabs" label="Library view">
            {TABS.map((t) => (
              <Chip
                key={t.id}
                selected={tab === t.id}
                onClick={() => {
                  setCustomizing(false);
                  go({ tab: t.id === "books" ? null : t.id });
                }}
              >
                {t.label}
              </Chip>
            ))}
          </Chips>

          {tab === "books" ? (
            <>
              <BookSections
                sections={sections}
                counts={counts}
                customizing={customizing}
                onChange={saveSections}
                onOpen={(id) => go({ shelf: id })}
                body={sectionBody}
                titleOf={titleOf}
              />
              {!customizing && sections.every((s) => s.hidden) ? (
                <EmptyState title="Everything here is hidden">
                  <button type="button" className="btn" onClick={() => setCustomizing(true)}>
                    Customize
                  </button>
                </EmptyState>
              ) : null}
            </>
          ) : null}

          {tab === "authors"
            ? byAuthor.map(({ name, items }) => (
                <GroupGrid key={name} title={name} count={items.length} onOpen={() => go({ author: name })}>
                  {items.map((b) => (
                    <BookCard key={b.id} book={b} sub={seriesLabel(b.series, b.seriesPosition)} />
                  ))}
                </GroupGrid>
              ))
            : null}

          {tab === "series" ? (
            books.some((b) => b.series) ? (
              bySeries.map(({ name, items, ordered }) => {
                const done = items.filter((b) => b.progress?.finished).length;
                return (
                  <GroupGrid
                    key={name}
                    title={name}
                    count={items.length}
                    sub={ordered[0]?.author}
                    side={done ? `${done} finished` : null}
                    onOpen={() => go({ series: name })}>
                    {ordered.map((b) => (
                      <BookCard key={b.id} book={b} sub={b.seriesPosition !== null ? `Book ${b.seriesPosition}` : b.author} />
                    ))}
                  </GroupGrid>
                );
              })
            ) : (
              <EmptyState>No series yet.</EmptyState>
            )
          ) : null}

          {tab === "finished" ? (
            <FinishedList books={books.filter((b) => b.progress?.finished)} />
          ) : null}
        </>
      )}

      {sortSheet}
    </>
  );
}

/**
 * The Books tab's sections in your order. Customizing doesn't swap in another view: the
 * same sections stay put, hidden and empty ones slide open, and each heading fades in a hide
 * button and a handle to drag it into order.
 */
function BookSections({
  sections,
  counts,
  customizing,
  onChange,
  onOpen,
  body,
  titleOf,
}: {
  sections: BookSection[];
  counts: Record<BookSectionId, number>;
  customizing: boolean;
  onChange: (next: BookSection[]) => void;
  onOpen: (id: BookSectionId) => void;
  body: (id: BookSectionId) => React.ReactNode;
  /** More like names its book. */
  titleOf: (id: BookSectionId) => string;
}) {
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= sections.length) return;
    const next = [...sections];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    onChange(next);
  };
  const sortable = useSortable(move);

  return (
    <div ref={sortable.listRef} className={sortable.sorting ? "sorting" : undefined}>
      {sections.map((s, i) => {
        const title = titleOf(s.id);
        const row = sortable.rowProps(i);
        // A hidden section's cards are only needed while customizing, where they slide open on Show.
        const cards = s.hidden && !customizing ? null : body(s.id);
        const shown = customizing || (!s.hidden && cards !== null);
        return (
          <section
            key={s.id}
            data-row
            className={`book-section ${shown ? "" : "collapsed"} ${s.hidden ? "is-hidden" : ""} ${row.className}`}
            style={row.style}
            inert={!shown}
          >
            <div className="book-section-inner">
              <div className="section-head">
                <SectionTitle
                  title={title}
                  count={counts[s.id]}
                  noun="book"
                  onOpen={() => {
                    if (!customizing) onOpen(s.id);
                  }}
                />
                <div className={`customize-actions ${customizing ? "" : "off"}`} inert={!customizing}>
                  <button
                    type="button"
                    className="btn btn-small"
                    aria-label={`${s.hidden ? "Show" : "Hide"} ${title}`}
                    onClick={() => onChange(sections.map((o) => (o.id === s.id ? { ...o, hidden: !o.hidden } : o)))}
                  >
                    {s.hidden ? "Show" : "Hide"}
                  </button>
                  <button
                    type="button"
                    className="icon-btn drag-handle"
                    aria-label={`Reorder ${title}. Use arrow keys to move.`}
                    onKeyDown={(ev) => {
                      if (ev.key === "ArrowUp") {
                        ev.preventDefault();
                        move(i, i - 1);
                      } else if (ev.key === "ArrowDown") {
                        ev.preventDefault();
                        move(i, i + 1);
                      }
                    }}
                    {...sortable.handleProps(i)}
                  >
                    <DragIcon />
                  </button>
                </div>
              </div>
              <div className={`section-body ${s.hidden ? "collapsed" : ""}`}>
                <div className="section-body-inner">{cards ?? <div className="muted small">Nothing here right now.</div>}</div>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** A Continue listening card. Only this card re-renders when its book plays or pauses, not the page. */
function ContinueCard({ book: b }: { book: BookSummary }) {
  const { current, playing } = useNowPlaying((n) => n.type === "book" && n.id === b.id);
  return (
    <Link href={`/book/${b.id}`} className={`continue-card${current ? " playing" : ""}`}>
      <div className="card-cover">
        <Cover
          src={b.coverHash ? apiPaths.coverUrl(b.id, b.coverHash, 600) : null}
          color={b.coverColor}
          title={b.title}
          subtitle={b.author}
          large
        />
        {current ? <Mixer playing={playing} /> : null}
      </div>
      <div className="bar thick">
        <div style={{ width: `${progressPct(b)}%` }} />
      </div>
      <div className="continue-text">
        <div className="card-title">{b.title}</div>
        {b.author ? <div className="card-sub">{b.author}</div> : null}
        <div className="card-sub">{timeLeft(b.durationSec, b.progress!.positionSec)}</div>
      </div>
    </Link>
  );
}

function SearchResults({ books, query }: { books: BookSummary[]; query: string }) {
  if (books.length === 0) return <EmptyState>{`Nothing matches "${query.trim()}".`}</EmptyState>;
  return (
    <div className="grid">
      {books.map((b) => (
        <BookCard key={b.id} book={b} sub={seriesLabel(b.series, b.seriesPosition) ?? b.author} />
      ))}
    </div>
  );
}

function FinishedList({ books }: { books: BookSummary[] }) {
  if (books.length === 0) return <EmptyState>No finished books yet.</EmptyState>;
  return (
    <div className="grid section">
      {[...books]
        .sort((a, b) => b.progress!.updatedAt - a.progress!.updatedAt)
        .map((b) => (
          <BookCard key={b.id} book={b} />
        ))}
    </div>
  );
}
