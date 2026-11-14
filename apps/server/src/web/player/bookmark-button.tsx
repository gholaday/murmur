"use client";

import { type BookmarkDto, bookmarkNear, bookmarkSpot } from "@murmur/shared/client";
import { newBookmark, useBookmarks } from "../bookmarks";
import { BookmarkIcon } from "../icons";
import { type Playable, usePlayerSelect } from "./engine";

/** Bookmarks the spot at `pos`, or edits the bookmark already there (then it's filled, in accent). */
export function BookmarkButton({ item, pos, onEdit }: { item: Playable; pos: number; onEdit: (edit: { bookmark: BookmarkDto; isNew: boolean }) => void }) {
  const bookmarks = useBookmarks(item.type, item.id);
  const playing = usePlayerSelect((p) => p.playing);
  const speed = usePlayerSelect((p) => p.speed);
  const near = bookmarkNear(bookmarks, pos);
  return (
    <button
      type="button"
      className={`icon-btn${near ? " on" : ""}`}
      aria-label={near ? "Edit bookmark" : "Bookmark this spot"}
      aria-pressed={!!near}
      onClick={() => onEdit(near ? { bookmark: near, isNew: false } : { bookmark: newBookmark(item, bookmarkSpot(pos, playing, speed)), isNew: true })}
    >
      <BookmarkIcon filled={!!near} />
    </button>
  );
}
