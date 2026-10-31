"use client";

import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { apiPaths, type BookmarkDto, type BookmarkItem, chapterAt, type ChapterDto, newBookmarkId, type PlayType } from "@murmur/shared/client";
import { api } from "./api";

/** How long a bookmark's toast stays up, matching the app's. */
export const BOOKMARK_TOAST_MS = 5000;

/** What a bookmark needs from the item it's in; a Playable fits. */
interface BookmarkTarget {
  type: PlayType;
  id: string;
  title: string;
  podcastId: string | null;
  chapters: ChapterDto[];
}

const NONE: BookmarkDto[] = [];
/** Removed here, with the server not told until the Undo toast ends. */
const undoable = new Set<string>();

/**
 * Your bookmarks for the player and the rows, outside React state so one change redraws only the
 * rows it touches. Pages start from the server's copy, so nothing pops in on first paint.
 */
const store = (() => {
  let loaded = false;
  let all: BookmarkDto[] = [];
  let byItem = new Map<string, BookmarkDto[]>();
  let byPodcast = new Map<string, BookmarkDto[]>();
  const listeners = new Set<() => void>();
  /** A list that didn't change keeps its array, so the rows reading it don't redraw. */
  const regroup = (old: Map<string, BookmarkDto[]>, keyOf: (b: BookmarkDto) => string | null) => {
    const next = new Map<string, BookmarkDto[]>();
    for (const b of all) {
      const key = keyOf(b);
      if (key) next.set(key, [...(next.get(key) ?? []), b]);
    }
    for (const [key, list] of next) {
      const was = old.get(key);
      if (was?.length === list.length && was.every((b, i) => b === list[i])) next.set(key, was);
    }
    return next;
  };
  return {
    get: () => all,
    forItem: (key: string, initial: BookmarkDto[]) => (loaded ? (byItem.get(key) ?? NONE) : initial),
    forPodcast: (id: string, initial: BookmarkDto[]) => (loaded ? (byPodcast.get(id) ?? NONE) : initial),
    /** The server's list, without any you've just removed and might still undo. */
    load(next: BookmarkDto[]) {
      loaded = true;
      this.set(next.filter((b) => !undoable.has(b.id)));
    },
    set(next: BookmarkDto[]) {
      all = next;
      byItem = regroup(byItem, (b) => `${b.itemType}:${b.itemId}`);
      byPodcast = regroup(byPodcast, (b) => b.podcastId);
      for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
})();

const inOrder = (list: BookmarkDto[]) => [...list].sort((a, b) => a.positionSec - b.positionSec);
const toItem = ({ id, itemType, itemId, positionSec, note, createdAt, updatedAt }: BookmarkDto): BookmarkItem => ({
  id,
  itemType,
  itemId,
  positionSec,
  note,
  createdAt,
  updatedAt,
});

/** One call at a time, so an Undo can't overtake the save it undoes, and a load sees every save before it. */
let queue: Promise<unknown> = Promise.resolve();
const inTurn = <T>(send: () => Promise<T>): Promise<T> => {
  const turn = queue.then(send, send);
  queue = turn;
  return turn;
};
/** Goes up with every change made here, so a load that's overtaken can start again. */
let edits = 0;
function change(next: BookmarkDto[]) {
  edits += 1;
  store.set(next);
}

const put = (b: BookmarkDto) => inTurn(() => api(apiPaths.bookmarks, { method: "PUT", body: { items: [toItem(b)] } }));
const del = (b: BookmarkDto) => inTurn(() => api(apiPaths.bookmark(b.id), { method: "DELETE" }));

/** Undoes one failed change, leaving any made since. */
function failed(undo: (now: BookmarkDto[]) => BookmarkDto[], message: string) {
  change(undo(store.get()));
  toast.error(message);
}
const without = (b: BookmarkDto) => (now: BookmarkDto[]) => now.filter((x) => x.id !== b.id);
const putBack = (b: BookmarkDto) => (now: BookmarkDto[]) => inOrder([...now.filter((x) => x.id !== b.id), b]);

export function addBookmark(item: BookmarkTarget, positionSec: number): BookmarkDto {
  if (item.type !== "book" && item.type !== "episode") throw new Error("Only books and episodes have bookmarks.");
  const now = Date.now();
  const multi = item.chapters.length > 1;
  const b: BookmarkDto = {
    id: newBookmarkId(),
    itemType: item.type,
    itemId: item.id,
    positionSec,
    note: null,
    createdAt: now,
    updatedAt: now,
    chapter: multi ? (item.chapters[chapterAt(item.chapters, positionSec)]?.title ?? null) : null,
    podcastId: item.podcastId,
    title: item.type === "episode" ? item.title : null,
  };
  change(putBack(b)(store.get()));
  put(b).catch(() => failed(without(b), "Couldn't save the bookmark."));
  return b;
}

export function updateBookmark(b: BookmarkDto, edit: { positionSec: number; note: string | null; chapter: string | null }) {
  const next = { ...b, ...edit, updatedAt: Date.now() };
  change(putBack(next)(store.get()));
  put(next).catch(() => failed(putBack(b), "Couldn't save the bookmark."));
}

export function deleteBookmark(b: BookmarkDto) {
  change(without(b)(store.get()));
  del(b).catch(() => failed(putBack(b), "Couldn't delete the bookmark."));
}

/** Takes it out at once and only tells the server when the toast ends, so Undo sends nothing. */
export function removeBookmarkWithUndo(b: BookmarkDto) {
  undoable.add(b.id);
  change(without(b)(store.get()));
  let settled = false;
  const send = () => {
    if (settled) return;
    settled = true;
    del(b)
      .catch(() => failed(putBack(b), "Couldn't delete the bookmark."))
      .finally(() => undoable.delete(b.id));
  };
  toast("Bookmark removed", {
    duration: BOOKMARK_TOAST_MS,
    action: {
      label: "Undo",
      onClick: () => {
        settled = true;
        undoable.delete(b.id);
        change(putBack(b)(store.get()));
      },
    },
    onAutoClose: send,
    onDismiss: send,
  });
}

/** Queued behind any saves, and started again if you change something while it's on its way. */
async function loadBookmarks() {
  for (;;) {
    const started = edits;
    const list = await inTurn(() => api<BookmarkDto[]>(apiPaths.bookmarks));
    if (started === edits) return store.load(list);
  }
}

/** Loads your bookmarks, and again whenever you come back to the tab. */
export function useBookmarkSync() {
  useEffect(() => {
    const load = () => {
      if (!document.hidden) void loadBookmarks().catch(() => undefined);
    };
    load();
    document.addEventListener("visibilitychange", load);
    return () => document.removeEventListener("visibilitychange", load);
  }, []);
}

/** One item's bookmarks, in order. `initial` is the server's copy, shown until the list has loaded. */
export function useBookmarks(type: PlayType | undefined, id: string | undefined, initial = NONE): BookmarkDto[] {
  const key = `${type}:${id}`;
  return useSyncExternalStore(
    store.subscribe,
    () => store.forItem(key, initial),
    () => initial,
  );
}

/** Every bookmark in a podcast's episodes. */
export function usePodcastBookmarks(podcastId: string, initial: BookmarkDto[]): BookmarkDto[] {
  return useSyncExternalStore(
    store.subscribe,
    () => store.forPodcast(podcastId, initial),
    () => initial,
  );
}
