"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  apiPaths,
  type BookSummary,
  bySeriesOrder,
  groupBy,
  matchesBook,
  plural,
  seriesLabel,
  sortBooks,
  type BookSort as Sort,
  timeLeft,
} from "@murmur/shared";
import { Cover } from "../cover";
import { BackIcon, FilterIcon, SearchIcon } from "../icons";
import { EditBookDialog, type EditTab } from "../book/edit-dialog";
import { Sheet, SheetItem } from "../sheet";
import { BookActionsContext, BookCard, progressPct } from "./book-card";

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

export function Library({ books, emptyReason, isAdmin }: { books: BookSummary[]; emptyReason: string; isAdmin: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string; tab: EditTab } | null>(null);
  const actions = useMemo(() => ({ isAdmin, edit: (id: string, tab: EditTab) => setEditing({ id, tab }) }), [isAdmin]);
  return (
    <BookActionsContext.Provider value={actions}>
      <LibraryView books={books} emptyReason={emptyReason} isAdmin={isAdmin} />
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

function LibraryView({ books, emptyReason, isAdmin }: { books: BookSummary[]; emptyReason: string; isAdmin: boolean }) {
  const router = useRouter();
  const [issue, setIssue] = useState<IssueId>("all");
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "books";
  const author = params.get("author");
  const series = params.get("series");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [sort, setSort] = useState<Sort>("added");
  const [sortOpen, setSortOpen] = useState(false);

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
  };

  const continuing = useMemo(
    () =>
      books
        .filter((b) => b.progress && !b.progress.finished && b.progress.positionSec > 5)
        .sort((a, b) => b.progress!.updatedAt - a.progress!.updatedAt)
        .slice(0, 12),
    [books],
  );
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

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Library</h1>
        <div className="head-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label="Search"
            aria-pressed={searching}
            onClick={() => {
              setSearching((s) => !s);
              setQuery("");
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
                onClick={() => go({ tab: t.id === "books" ? null : t.id })}
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
                onClick={() => go({ tab: "attention" })}
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
              {continuing.length ? (
                <section className="section">
                  <h2 className="section-title">Continue listening</h2>
                  <div className="row-scroll">
                    {continuing.map((b) => (
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
                </section>
              ) : null}
              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">
                    All books
                    <span className="count-pill" aria-label={plural(books.length, "book")}>
                      {books.length}
                    </span>
                  </h2>
                </div>
                <div className="grid">
                  {sorted.map((b) => (
                    <BookCard key={b.id} book={b} />
                  ))}
                </div>
              </section>
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
