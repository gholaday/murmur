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
  groupBy,
  matchesBook,
  plural,
  seriesLabel,
  sortBooks,
  type BookSort as Sort,
  timeLeft,
} from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { BackIcon, CustomizeIcon, DragIcon, FilterIcon, SearchIcon } from "../icons";
import { EditBookDialog, type EditTab } from "../book/edit-dialog";
import { Sheet, SheetItem } from "../sheet";
import { useSortable } from "../sortable";
import { BookActionsContext, BookCard, progressPct } from "./book-card";
import { continueListening, SHELF_SIZE, SHELF_TITLES, shelfBooks, type ShelfId } from "./shelves";

type Tab = "books" | "authors" | "series" | "finished" | "attention";

/** Problems an admin can fix from the edit dialog. "Not matched" is only listed on request. */
const ISSUES = [
  { id: "cover", label: "No cover", test: (b: BookSummary) => !b.coverHash },
  { id: "author", label: "Unknown author", test: (b: BookSummary) => !b.author },
  { id: "missing", label: "Files missing", test: (b: BookSummary) => b.missingSince !== null },
  { id: "unmatched", label: "Not matched", test: (b: BookSummary) => !b.matched },
] as const;
type IssueId = (typeof ISSUES)[number]["id"] | "all";
const issuesOf = (b: BookSummary) => ISSUES.filter((i) => i.id !== "unmatched" && i.test(b));

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "books", label: "Books" },
  { id: "authors", label: "Authors" },
  { id: "series", label: "Series" },
  { id: "finished", label: "Finished" },
];

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: "added", label: "Recently added" },
  { id: "listened", label: "Recently listened" },
  { id: "title", label: "Title" },
  { id: "author", label: "Author" },
];

const SORT_KEY = "murmur.librarySort";
/** Under a Next in series card: which book it is (series names are too long to fit), else the author. */
const nextSub = (b: BookSummary) => (b.seriesPosition !== null ? `Book ${b.seriesPosition}` : b.author);
/** A titled section of book cards, like "All books": the heading opens that author or series. */
function GroupGrid({
  title,
  count,
  sub,
  side,
  onOpen,
  children,
}: {
  title: string;
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
          <button type="button" className="section-title group-title" onClick={onOpen}>
            {title}
            <span className="count-pill" aria-label={plural(count, "book")}>
              {count}
            </span>
          </button>
          {sub ? <span className="muted small">{sub}</span> : null}
        </div>
        {side ? <span className="muted small">{side}</span> : null}
      </div>
      <div className="shelf">{children}</div>
    </section>
  );
}

/** Keeps the count pill on the same line as the title's last word when it wraps. */
function TitleWithCount({ title, count }: { title: string; count: number }) {
  const cut = title.lastIndexOf(" ") + 1;
  return (
    <>
      {title.slice(0, cut)}
      <span style={{ whiteSpace: "nowrap" }}>
        {title.slice(cut)}
        <span className="count-pill" aria-label={plural(count, "book")}>
          {count}
        </span>
      </span>
    </>
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
  const router = useRouter();
  const { isAdmin } = props;
  const [editing, setEditing] = useState<{ id: string; tab: EditTab } | null>(null);
  const actions = useMemo(() => ({ isAdmin, edit: (id: string, tab: EditTab) => setEditing({ id, tab }) }), [isAdmin]);
  return (
    <BookActionsContext.Provider value={actions}>
      <LibraryView {...props} />
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

function LibraryView({ books, emptyReason, isAdmin, today, sections: savedSections }: LibraryProps) {
  const router = useRouter();
  const [issue, setIssue] = useState<IssueId>("all");
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "books";
  const author = params.get("author");
  const series = params.get("series");
  const shelfParam = params.get("shelf");
  const shelf = shelfParam && shelfParam in SHELF_TITLES ? (shelfParam as ShelfId) : null;
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
      const saved = localStorage.getItem(SORT_KEY) as Sort | null;
      if (saved && SORTS.some((s) => s.id === saved)) setSort(saved);
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
      next: shelfBooks("next", books, today),
      added: shelfBooks("added", books, today),
      unstarted: shelfBooks("unstarted", books, today),
    }),
    [books, today],
  );
  const counts: Record<BookSectionId, number> = {
    continue: continuing.length,
    next: shelves.next.length,
    added: shelves.added.length,
    unstarted: shelves.unstarted.length,
    all: books.length,
  };
  const sorted = useMemo(() => sortBooks(books, sort), [books, sort]);
  const attentionCount = useMemo(() => books.filter((b) => issuesOf(b).length > 0).length, [books]);
  const q = query.trim().toLowerCase();

  if (books.length === 0) {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">Library</h1>
        </div>
        <div className="empty">
          <strong>No books yet</strong>
          {emptyReason}
        </div>
      </>
    );
  }

  // A shelf's full list, opened from its heading.
  if (shelf) {
    const list = shelfBooks(shelf, books, today);
    return (
      <>
        <div className="back-row">
          <button type="button" className="icon-btn" onClick={() => router.back()} aria-label="Back">
            <BackIcon />
          </button>
        </div>
        <div className="page-head">
          <h1 className="page-title" style={{ fontSize: 26 }}>
            <TitleWithCount title={SHELF_TITLES[shelf]} count={list.length} />
          </h1>
        </div>
        {list.length ? (
          <div className="grid">
            {list.map((b) => (
              <BookCard key={b.id} book={b} sub={shelf === "next" ? nextSub(b) : undefined} />
            ))}
          </div>
        ) : (
          <div className="empty">Nothing here right now.</div>
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
        <div className="back-row">
          <button type="button" className="icon-btn" onClick={() => router.back()} aria-label="Back">
            <BackIcon />
          </button>
        </div>
        <div className="page-head">
          <div style={{ minWidth: 0 }}>
            <h1 className="page-title" style={{ fontSize: 26 }}>
              <TitleWithCount title={author ?? series ?? ""} count={list.length} />
            </h1>
            {series && list[0]?.author ? <div className="page-sub">{list[0].author}</div> : null}
          </div>
        </div>
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
                  <button type="button" className="section-title group-title" onClick={() => go({ series: name })}>
                    {name}
                    <span className="count-pill" aria-label={plural(items.length, "book")}>
                      {items.length}
                    </span>
                  </button>
                </div>
                <div className="shelf">
                  {[...items].sort(bySeriesOrder).map((b) => (
                    <BookCard key={b.id} book={b} sub={b.seriesPosition !== null ? `Book ${b.seriesPosition}` : null} />
                  ))}
                </div>
              </section>
            ))}
            {standalone.length ? (
              <section className="section">
                {groups.length ? <h2 className="section-title">Standalone</h2> : null}
                <div className="shelf">
                  {sortBooks(standalone, "title").map((b) => (
                    <BookCard key={b.id} book={b} sub={null} />
                  ))}
                </div>
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
        <div className="row-scroll">
          {continuing.slice(0, SHELF_SIZE).map((b) => (
            <Link key={b.id} href={`/book/${b.id}`} className="continue-card">
              <Cover
                src={b.coverHash ? apiPaths.coverUrl(b.id, b.coverHash, 600) : null}
                color={b.coverColor}
                title={b.title}
                subtitle={b.author}
                large
              />
              <div className="bar thick">
                <div style={{ width: `${progressPct(b)}%` }} />
              </div>
              <div className="muted small">{timeLeft(b.durationSec, b.progress!.positionSec)}</div>
            </Link>
          ))}
        </div>
      ) : null;
    }
    if (id === "all") {
      return (
        <div className="grid">
          {sorted.map((b) => (
            <BookCard key={b.id} book={b} />
          ))}
        </div>
      );
    }
    const list = shelves[id];
    return list.length ? (
      <div className="shelf">
        {list.slice(0, SHELF_SIZE).map((b) => (
          <BookCard key={b.id} book={b} sub={id === "next" ? nextSub(b) : undefined} />
        ))}
      </div>
    ) : null;
  };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Library</h1>
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
        <div className="search">
          <SearchIcon />
          <input
            className="input"
            type="search"
            placeholder="Title, author, narrator or series"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search library"
            autoFocus
          />
        </div>
      ) : null}

      {q ? (
        <SearchResults books={sorted.filter((b) => matchesBook(b, q))} />
      ) : (
        <>
          <div className="chips" role="tablist" aria-label="Library view">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                className="chip"
                aria-selected={tab === t.id}
                aria-pressed={tab === t.id}
                onClick={() => {
                  setCustomizing(false);
                  go({ tab: t.id === "books" ? null : t.id });
                }}
              >
                {t.label}
              </button>
            ))}
            {isAdmin && (attentionCount > 0 || tab === "attention") ? (
              <button
                type="button"
                role="tab"
                className="chip chip-warn"
                aria-selected={tab === "attention"}
                aria-pressed={tab === "attention"}
                onClick={() => {
                  setCustomizing(false);
                  go({ tab: "attention" });
                }}
              >
                Needs attention
                <span className="count-pill">{attentionCount}</span>
              </button>
            ) : null}
          </div>

          {tab === "attention" ? (
            <AttentionView books={sorted} issue={issue} setIssue={setIssue} />
          ) : null}

          {tab === "books" ? (
            <>
              <BookSections
                sections={sections}
                counts={counts}
                customizing={customizing}
                onChange={saveSections}
                onOpen={(id) => go({ shelf: id })}
                body={sectionBody}
              />
              {!customizing && sections.every((s) => s.hidden) ? (
                <div className="empty">
                  <strong>Everything here is hidden</strong>
                  <button type="button" className="btn" onClick={() => setCustomizing(true)}>
                    Customize
                  </button>
                </div>
              ) : null}
            </>
          ) : null}

          {tab === "authors"
            ? groupBy(books, (b) => b.author).map(([name, items]) => (
                <GroupGrid key={name} title={name} count={items.length} onOpen={() => go({ author: name })}>
                  {sortBooks(items, "author").map((b) => (
                    <BookCard key={b.id} book={b} sub={seriesLabel(b.series, b.seriesPosition)} />
                  ))}
                </GroupGrid>
              ))
            : null}

          {tab === "series" ? (
            books.some((b) => b.series) ? (
              groupBy(books, (b) => b.series).map(([name, items]) => {
                const ordered = [...items].sort(bySeriesOrder);
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
              <div className="empty">No series yet.</div>
            )
          ) : null}

          {tab === "finished" ? (
            <FinishedList books={books.filter((b) => b.progress?.finished)} />
          ) : null}
        </>
      )}

      <Sheet open={sortOpen} onClose={() => setSortOpen(false)} title="Sort books">
        {SORTS.map((s) => (
          <SheetItem
            key={s.id}
            active={sort === s.id}
            onClick={() => {
              setSort(s.id);
              setSortOpen(false);
              try {
                localStorage.setItem(SORT_KEY, s.id);
              } catch {
                // private mode
              }
            }}
          >
            {s.label}
          </SheetItem>
        ))}
      </Sheet>
    </>
  );
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <>
      {title}
      <span className="count-pill" aria-label={plural(count, "book")}>
        {count}
      </span>
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
}: {
  sections: BookSection[];
  counts: Record<BookSectionId, number>;
  customizing: boolean;
  onChange: (next: BookSection[]) => void;
  onOpen: (id: BookSectionId) => void;
  body: (id: BookSectionId) => React.ReactNode;
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
        const title = BOOK_SECTION_TITLES[s.id];
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
                {s.id === "all" ? (
                  <h2 className="section-title">
                    <SectionTitle title={title} count={counts[s.id]} />
                  </h2>
                ) : (
                  <button
                    type="button"
                    className="section-title group-title"
                    onClick={() => {
                      if (!customizing) onOpen(s.id);
                    }}
                  >
                    <SectionTitle title={title} count={counts[s.id]} />
                  </button>
                )}
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

function AttentionView({ books, issue, setIssue }: { books: BookSummary[]; issue: IssueId; setIssue: (i: IssueId) => void }) {
  const counts = new Map(ISSUES.map((i) => [i.id, books.filter(i.test).length]));
  const list = issue === "all" ? books.filter((b) => issuesOf(b).length > 0) : books.filter(ISSUES.find((i) => i.id === issue)!.test);
  return (
    <section className="section">
      <div className="chips" aria-label="Problem">
        <button type="button" className="chip" aria-pressed={issue === "all"} onClick={() => setIssue("all")}>
          All problems
        </button>
        {ISSUES.map((i) => (
          <button key={i.id} type="button" className="chip" aria-pressed={issue === i.id} onClick={() => setIssue(i.id)}>
            {i.label}
            <span className="count-pill">{counts.get(i.id)}</span>
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <div className="empty">Nothing to fix here.</div>
      ) : (
        <div className="grid">
          {list.map((b) => (
            <BookCard key={b.id} book={b} sub={(issue === "unmatched" ? [ISSUES[3]] : issuesOf(b)).map((i) => i.label).join(", ")} />
          ))}
        </div>
      )}
    </section>
  );
}

function SearchResults({ books }: { books: BookSummary[] }) {
  if (books.length === 0) return <div className="empty">No books match that search.</div>;
  return (
    <div className="grid">
      {books.map((b) => (
        <BookCard key={b.id} book={b} sub={seriesLabel(b.series, b.seriesPosition) ?? b.author} />
      ))}
    </div>
  );
}

function FinishedList({ books }: { books: BookSummary[] }) {
  if (books.length === 0) return <div className="empty">No finished books yet.</div>;
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
