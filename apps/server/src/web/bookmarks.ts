"use client";

import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { type BookmarkDto, clock, createBookmarkStore, type PlayType } from "@murmur/shared/client";
import { api, refused } from "./api";
import { getJson, removeKey, setJson } from "./storage";

export { newBookmark } from "@murmur/shared/client";

// Your bookmarks: the shared offline-first store (packages/shared/src/bookmark-store.ts), kept in
// this browser. Pages start from the server's copy, so nothing pops in on first paint.

const store = createBookmarkStore({
  api: (path, init) => api(path, init),
  getJson,
  setJson,
  removeKey,
  toastError: (message) => toast.error(message),
  refused,
});

export function addBookmark(b: BookmarkDto) {
  store.add(b);
  toast(`Bookmarked ${clock(b.positionSec)}`, { duration: 5000, action: { label: "Undo", onClick: () => store.remove(b) } });
}

export const updateBookmark = store.update;
export const deleteBookmark = store.remove;

/** Loads your bookmarks, and again whenever you come back to the tab or back online. */
export function useBookmarkSync() {
  useEffect(() => {
    const load = () => {
      if (!document.hidden) void store.refresh();
    };
    load();
    document.addEventListener("visibilitychange", load);
    window.addEventListener("online", load);
    return () => {
      document.removeEventListener("visibilitychange", load);
      window.removeEventListener("online", load);
    };
  }, []);
}

const NONE: BookmarkDto[] = [];

/** Drops this account's bookmarks and anything unsent, on sign-out, so they never reach the next one. */
export const forgetBookmarks = store.forget;

/** One item's bookmarks, in order. `initial` is the server's copy, shown until the list has loaded. */
export function useBookmarks(type: PlayType | undefined, id: string | undefined, initial = NONE): BookmarkDto[] {
  return useSyncExternalStore(
    store.subscribe,
    () => (store.loaded() ? store.forItem(type, id) : initial),
    () => initial,
  );
}

/** Every bookmark in a podcast's episodes. */
export function usePodcastBookmarks(podcastId: string, initial: BookmarkDto[]): BookmarkDto[] {
  return useSyncExternalStore(
    store.subscribe,
    () => (store.loaded() ? store.forPodcast(podcastId) : initial),
    () => initial,
  );
}
