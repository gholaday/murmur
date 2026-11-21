"use client";

import { type AlbumSummary, type BookSummary, bookIssues, LIBRARY_LIST_TEXT, type LibraryList } from "@murmur/shared/client";
import { BulkMatch } from "../library/bulk-match";
import { BookCard } from "../library/book-card";
import { BookActions } from "../book/book-actions";
import { AlbumMatchAll } from "../music/match-all";
import { AlbumCard } from "../music/music-view";
import { EmptyState, NestedHead } from "../ui";

/** One of You > Library's lists for admins, opened from its row. */
export function LibraryListView({ list, books, albums }: { list: LibraryList; books: BookSummary[]; albums: AlbumSummary[] }) {
  const { title, sub } = LIBRARY_LIST_TEXT[list];
  // The head is drawn by the list, so Match all can sit among its actions.
  const head = (action: React.ReactNode) => <NestedHead title={title} sub={sub} fallback="/you/library" actions={action} />;
  return list === "albums" ? <AlbumList albums={albums} head={head} /> : <BookList list={list} books={books} head={head} />;
}

type Head = (action: React.ReactNode) => React.ReactNode;

function BookList({ list, books, head }: { list: "attention" | "unmatched"; books: BookSummary[]; head: Head }) {
  const shown = list === "unmatched" ? books.filter((b) => !b.matched) : books.filter((b) => bookIssues(b).length > 0);
  const grid = (
    <section className="section">
      {shown.length ? (
        <div className="grid">
          {shown.map((b) => (
            // Unmatched books already carry a "Not matched" mark on the cover, so they show their author.
            <BookCard key={b.id} book={b} sub={list === "unmatched" ? undefined : bookIssues(b).join(", ")} />
          ))}
        </div>
      ) : (
        <EmptyState>{LIBRARY_LIST_TEXT[list].empty}</EmptyState>
      )}
    </section>
  );
  return (
    <BookActions>
      {list === "unmatched" ? (
        <BulkMatch unmatched={shown.filter((b) => b.missingSince === null).length} head={head}>
          {grid}
        </BulkMatch>
      ) : (
        <>
          {head(null)}
          {grid}
        </>
      )}
    </BookActions>
  );
}

function AlbumList({ albums, head }: { albums: AlbumSummary[]; head: Head }) {
  const shown = albums.filter((a) => !a.matched);
  return (
    <AlbumMatchAll albums={shown} head={head}>
      <section className="section">
        {shown.length ? (
          <div className="grid">
            {shown.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </div>
        ) : (
          <EmptyState>{LIBRARY_LIST_TEXT.albums.empty}</EmptyState>
        )}
      </section>
    </AlbumMatchAll>
  );
}
