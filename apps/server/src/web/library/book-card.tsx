import Link from "next/link";
import { apiPaths, type BookSummary } from "@murmur/shared";
import { Cover } from "../cover";
import { CheckIcon } from "../icons";

export function progressPct(b: BookSummary): number {
  if (!b.progress || b.durationSec <= 0) return 0;
  return Math.min(100, (b.progress.positionSec / b.durationSec) * 100);
}

export function BookCard({ book, sub }: { book: BookSummary; sub?: string | null }) {
  const pct = progressPct(book);
  const started = !!book.progress && !book.progress.finished && pct > 0;
  return (
    <Link href={`/book/${book.id}`} className="card">
      <Cover
        src={book.coverHash ? apiPaths.coverUrl(book.id, book.coverHash, 200) : null}
        color={book.coverColor}
        title={book.title}
        subtitle={book.author}
      />
      {book.progress?.finished ? (
        <span className="card-done" aria-label="Finished">
          <CheckIcon size={14} />
        </span>
      ) : null}
      {started ? (
        <div className="bar" aria-hidden="true">
          <div style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      <div className="card-title">{book.title}</div>
      <div className="card-sub">{sub === undefined ? (book.author ?? "Unknown author") : sub}</div>
    </Link>
  );
}
