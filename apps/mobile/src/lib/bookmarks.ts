import { useSyncExternalStore } from "react";
import { type BookmarkDto, createBookmarkStore, type PlayType } from "@murmur/shared/client";
import { toast } from "@/components/toast";
import { api, HttpError } from "./api";
import { getJson, removeKey, setJson } from "./storage";

// Your bookmarks, offline first: the shared store (an outbox replayed on the last list from the
// server), kept on the phone. Outside React, so one change redraws only the rows it touches.

export { newBookmark } from "@murmur/shared/client";

const store = createBookmarkStore({
  api,
  getJson,
  setJson,
  removeKey,
  toastError: (message) => toast.error(message),
  // Only the server turning it down drops a change; offline, a 401 or a 429 tries again later.
  refused: (err) => err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 429,
});

export const addBookmark = store.add;
export const updateBookmark = store.update;
export const deleteBookmark = store.remove;
export const flushBookmarks = store.flush;
export const refreshBookmarks = store.refresh;
export const forgetBookmarks = store.forget;

/** One item's bookmarks right now, for code outside React. */
export const bookmarksFor = (type: PlayType, id: string) => store.forItem(type, id);

/** One item's bookmarks, in order. */
export function useBookmarks(type: PlayType | undefined, id: string | undefined): BookmarkDto[] {
  return useSyncExternalStore(store.subscribe, () => store.forItem(type, id));
}

/** Every bookmark in a podcast's episodes. */
export function usePodcastBookmarks(podcastId: string): BookmarkDto[] {
  return useSyncExternalStore(store.subscribe, () => store.forPodcast(podcastId));
}
