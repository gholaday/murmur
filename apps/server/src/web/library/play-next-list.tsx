"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiPaths, type BookSummary, duration, errorText } from "@murmur/shared/client";
import { api } from "../api";
import { setPlayNext } from "../book/play-next";
import { Cover } from "../cover";
import { CloseIcon } from "../icons";
import { DragHandle, reorder, useSortable } from "../sortable";
import { EmptyState, NestedHead } from "../ui";

/** The whole Play next shelf, dragged into the order the books should come in. */
export function PlayNextList({ books }: { books: BookSummary[] }) {
  const router = useRouter();
  const [order, setOrder] = useState(books);
  useEffect(() => setOrder(books), [books]);

  const sortable = useSortable((from, to) => {
    const previous = order;
    const next = reorder(order, from, to);
    setOrder(next);
    api(apiPaths.playNextOrder, { method: "PUT", body: { bookIds: next.map((b) => b.id) } }).catch((err: unknown) => {
      setOrder(previous);
      toast.error(errorText(err));
    });
  });

  return (
    <>
      <NestedHead title="Play next" />
      {order.length === 0 ? (
        <EmptyState title="Nothing lined up">Add books from their menu, with Add to Play next.</EmptyState>
      ) : (
        <div ref={sortable.listRef} className={`list ${sortable.sorting ? "sorting" : ""}`}>
          {order.map((b, i) => {
            const row = sortable.rowProps(i);
            return (
              <div key={b.id} data-row className={`queue-row ${row.className}`} style={row.style}>
                <Link href={`/book/${b.id}`} className="list-row-play">
                  <Cover src={b.coverHash ? apiPaths.coverUrl(b.id, b.coverHash, 200) : null} color={b.coverColor} title={b.title} className="thumb" />
                  <span className="list-row-main">
                    <span className="list-row-title">{b.title}</span>
                    <span className="list-row-sub">{b.author ?? "Unknown author"}</span>
                  </span>
                </Link>
                <span className="muted small">{duration(b.durationSec)}</span>
                <button
                  type="button"
                  className="icon-btn dim"
                  aria-label={`Remove ${b.title} from Play next`}
                  onClick={() => void setPlayNext(b.id, false, () => router.refresh()).catch((err: unknown) => toast.error(errorText(err)))}
                >
                  <CloseIcon size={20} />
                </button>
                <DragHandle label={b.title} {...sortable.handleProps(i)} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
