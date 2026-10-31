import { useSyncExternalStore } from "react";
import { apiPaths, type BookmarkDto, type BookmarkItem, chapterAt, type ChapterDto, newBookmarkId, type PlayType } from "@murmur/shared/client";
import { toast } from "@/components/toast";
import { api, HttpError } from "./api";
import { getJson, removeKey, setJson } from "./storage";

// Your bookmarks, offline first. The last list from the server is kept on the phone, and each change
// goes into an outbox replayed in order on top of it, so they work on downloads and on a plane.
// Outside React, so one change redraws only the rows it touches. Matches the web's bookmarks.ts.

/** What a bookmark needs from the item it's in; a Playable fits. */
interface BookmarkTarget {
  type: PlayType;
  id: string;
  title: string;
  podcastId: string | null;
  chapters: ChapterDto[];
}

type Op = { op: "upsert"; bookmark: BookmarkDto } | { op: "delete"; bookmark: BookmarkDto };

const LIST_KEY = "murmur.bookmarks";
const OUTBOX_KEY = "murmur.bookmarkOutbox";
const NONE: BookmarkDto[] = [];

let base = getJson<BookmarkDto[]>(LIST_KEY) ?? [];
let outbox = getJson<Op[]>(OUTBOX_KEY) ?? [];
/** Taken out for now, while a toast offers Undo; nothing has been sent. */
const hidden = new Set<string>();

let all: BookmarkDto[] = [];
let byItem = new Map<string, BookmarkDto[]>();
let byPodcast = new Map<string, BookmarkDto[]>();
const listeners = new Set<() => void>();

const apply = (list: BookmarkDto[], o: Op) => {
  const rest = list.filter((b) => b.id !== o.bookmark.id);
  return o.op === "upsert" ? [...rest, o.bookmark] : rest;
};

/** A list that didn't change keeps its array, so the rows reading it don't redraw. */
function regroup(old: Map<string, BookmarkDto[]>, keyOf: (b: BookmarkDto) => string | null) {
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
}

function changed() {
  all = outbox.reduce(apply, base).filter((b) => !hidden.has(b.id));
  all.sort((a, b) => a.positionSec - b.positionSec);
  byItem = regroup(byItem, (b) => `${b.itemType}:${b.itemId}`);
  byPodcast = regroup(byPodcast, (b) => b.podcastId);
  listeners.forEach((l) => l());
}
changed();

function queue(o: Op) {
  outbox = [...outbox, o];
  setJson(OUTBOX_KEY, outbox);
  changed();
  void flushBookmarks();
}

const toItem = ({ id, itemType, itemId, positionSec, note, createdAt, updatedAt }: BookmarkDto): BookmarkItem => ({
  id,
  itemType,
  itemId,
  positionSec,
  note,
  createdAt,
  updatedAt,
});

/** Sends made since the list was last read; a read that overlaps one is stale. */
let sent = 0;
let sending: Promise<void> | null = null;

/** Sends what's waiting, in order; offline it stops and keeps the rest. */
export function flushBookmarks(): Promise<void> {
  // Before the block below: with nothing to send it would finish at once and leave `sending` set for good.
  if (!outbox.length) return sending ?? Promise.resolve();
  sending ??= (async () => {
    try {
      while (outbox[0]) {
        const o = outbox[0];
        try {
          if (o.op === "upsert") await api(apiPaths.bookmarks, { method: "PUT", body: { items: [toItem(o.bookmark)] } });
          else await api(apiPaths.bookmark(o.bookmark.id), { method: "DELETE" });
          base = apply(base, o);
          sent++;
        } catch (err) {
          // Only the server turning it down drops it; anything else tries again later.
          if (!(err instanceof HttpError) || err.status < 400 || err.status >= 500 || err.status === 401 || err.status === 429) return;
          toast.error(o.op === "upsert" ? "Couldn't save the bookmark." : "Couldn't delete the bookmark.");
        }
        outbox = outbox.filter((x) => x !== o);
        setJson(OUTBOX_KEY, outbox);
        setJson(LIST_KEY, base);
        changed();
      }
    } finally {
      sending = null;
    }
  })();
  return sending;
}

/** Sends what's waiting, then takes the server's list as the new base. An older server has none, which is fine. */
export async function refreshBookmarks(): Promise<void> {
  await flushBookmarks();
  if (outbox.length) return;
  const seen = sent;
  try {
    const list = await api<BookmarkDto[]>(apiPaths.bookmarks);
    if (seen !== sent) return refreshBookmarks();
    base = list;
    setJson(LIST_KEY, base);
    changed();
  } catch {
    // The saved list stands.
  }
}

/** Drops this account's bookmarks and anything unsent, on sign-out, so they never reach the next one. */
export function forgetBookmarks() {
  base = [];
  outbox = [];
  hidden.clear();
  removeKey(LIST_KEY);
  removeKey(OUTBOX_KEY);
  changed();
}

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
  queue({ op: "upsert", bookmark: b });
  return b;
}

export function updateBookmark(b: BookmarkDto, change: { positionSec: number; note: string | null }) {
  queue({ op: "upsert", bookmark: { ...b, ...change, updatedAt: Date.now() } });
}

export const deleteBookmark = (b: BookmarkDto) => queue({ op: "delete", bookmark: b });

/** Takes it out at once and only queues the delete when the toast ends, so Undo sends nothing. */
export function removeBookmarkWithUndo(b: BookmarkDto) {
  hidden.add(b.id);
  changed();
  toast.show("Bookmark removed", {
    action: {
      label: "Undo",
      onPress: () => {
        hidden.delete(b.id);
        changed();
      },
    },
    duration: 5000,
    // Undo or a sign-out already took it off the list, and then there's nothing to send.
    onEnd: () => {
      if (hidden.delete(b.id)) deleteBookmark(b);
    },
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** One item's bookmarks right now, for code outside React. */
export const bookmarksFor = (type: PlayType, id: string) => byItem.get(`${type}:${id}`) ?? NONE;

/** One item's bookmarks, in order. */
export function useBookmarks(type: PlayType | undefined, id: string | undefined): BookmarkDto[] {
  const key = `${type}:${id}`;
  return useSyncExternalStore(subscribe, () => byItem.get(key) ?? NONE);
}

/** Every bookmark in a podcast's episodes. */
export function usePodcastBookmarks(podcastId: string): BookmarkDto[] {
  return useSyncExternalStore(subscribe, () => byPodcast.get(podcastId) ?? NONE);
}
