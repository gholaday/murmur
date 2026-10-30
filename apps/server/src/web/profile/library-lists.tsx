"use client";

import { type AlbumSummary, type BookSummary, bookIssues } from "@murmur/shared/client";
import { BulkMatch } from "../library/bulk-match";
import { BookCard } from "../library/book-card";
import { BookActions } from "../library/library";
import { AlbumMatchAll } from "../music/match-all";
import { AlbumCard } from "../music/music-view";
import { EmptyState, NestedHead } from "../ui";

export type LibraryList = "attention" | "unmatched" | "albums";

const LIBRARY_LISTS: Record<LibraryList, { title: string; sub: string }> = {
  attention: { title: "Needs attention", sub: "Books with no cover, no author or missing files" },
  unmatched: { title: "Not matched", sub: "Books with no online match yet" },
  albums: { title: "Not matched", sub: "Albums with no online match yet" },
};

/** One of You > Library's lists for admins, opened from its row. */
export function LibraryListView({ list, books, albums }: { list: LibraryList; books: BookSummary[]; albums: AlbumSummary[] }) {
  const { title, sub } = LIBRARY_LISTS[list];
  return (
    <>
      <NestedHead title={title} sub={sub} fallback="/you/library" />
      <section className="section">
        {list === "albums" ? <AlbumList albums={albums} /> : <BookList list={list} books={books} />}
      </section>
    </>
  );
}

function BookList({ list, books }: { list: "attention" | "unmatched"; books: BookSummary[] }) {
  const shown = list === "unmatched" ? books.filter((b) => !b.matched) : books.filter((b) => bookIssues(b).length > 0);
  const grid = shown.length ? (
    <div className="grid">
      {shown.map((b) => (
        // Unmatched books already carry a "Not matched" mark on the cover, so they show their author.
        <BookCard key={b.id} book={b} sub={list === "unmatched" ? undefined : bookIssues(b).join(", ")} />
      ))}
    </div>
  ) : (
    <EmptyState>{list === "unmatched" ? "Every book is matched." : "Nothing to fix here."}</EmptyState>
  );
  return (
    <BookActions isAdmin>
      {list === "unmatched" ? <BulkMatch unmatched={shown.filter((b) => b.missingSince === null).length}>{grid}</BulkMatch> : grid}
    </BookActions>
  );
}

function AlbumList({ albums }: { albums: AlbumSummary[] }) {
  const shown = albums.filter((a) => !a.matched);
  const grid = shown.length ? (
    <div className="grid">
      {shown.map((a) => (
        <AlbumCard key={a.id} album={a} />
      ))}
    </div>
  ) : (
    <EmptyState>Every album is matched.</EmptyState>
  );
  return <AlbumMatchAll albums={shown}>{grid}</AlbumMatchAll>;
}
