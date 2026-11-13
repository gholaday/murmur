"use client";

import { chapterAt } from "@murmur/shared/client";
import { BookmarkRows } from "../bookmark-rows";
import { useBookmarks } from "../bookmarks";
import { ChapterList } from "../chapter-list";
import { EmptyState } from "../ui";
import { usePlayerControls, usePlayerSelect, usePosition } from "./engine";

// What's playing's chapters and bookmarks, wired to the player: the lists the player's sheets show.

/** The chapters of what's playing, the current one marked; picking one seeks there. */
export function NowChapters({ onPicked }: { onPicked?: () => void }) {
  const item = usePlayerSelect((p) => p.item);
  const playing = usePlayerSelect((p) => p.playing);
  const position = usePosition();
  const { seek } = usePlayerControls();
  if (!item) return null;
  return (
    <ChapterList
      chapters={item.chapters}
      current={chapterAt(item.chapters, position)}
      playing={playing}
      onPick={(sec) => {
        seek(sec);
        onPicked?.();
      }}
    />
  );
}

/** The bookmarks of what's playing; picking one jumps there, offering a way back. */
export function NowBookmarks({ onPicked }: { onPicked?: () => void }) {
  const item = usePlayerSelect((p) => p.item);
  const bookmarks = useBookmarks(item?.type, item?.id);
  const { jumpTo } = usePlayerControls();
  if (!bookmarks.length) return <EmptyState title="No bookmarks yet">Tap the bookmark beside the title to save a spot.</EmptyState>;
  return (
    <BookmarkRows
      bookmarks={bookmarks}
      onJump={(b) => {
        onPicked?.();
        void jumpTo({ itemType: b.itemType, itemId: b.itemId }, b.positionSec);
      }}
    />
  );
}
