// Your bookmarks, offline first, for both clients. The last list from the server is kept on the
// device, and each change goes into an outbox replayed in order on top of it, so bookmarks work on
// downloads and on a plane. One change redraws only the rows it touches: a list that didn't change
// keeps its array.

import { apiPaths } from "./api-paths";
import { newBookmarkId } from "./bookmarks";
import type { BookmarkDto, BookmarkItem, ChapterDto, PlayType } from "./index";
import { addTo } from "./library";
import { chapterAt } from "./player";

/** What a bookmark needs from the item it's in; a Playable fits. */
export interface BookmarkTarget {
  type: PlayType;
  id: string;
  title: string;
  podcastId: string | null;
  chapters: ChapterDto[];
}

/** A bookmark for the note sheet to fill in, saved only by `add`. */
export function newBookmark(item: BookmarkTarget, positionSec: number): BookmarkDto {
  if (item.type !== "book" && item.type !== "episode") throw new Error("Only books and episodes have bookmarks.");
  const now = Date.now();
  return {
    id: newBookmarkId(),
    itemType: item.type,
    itemId: item.id,
    positionSec,
    note: null,
    createdAt: now,
    updatedAt: now,
    chapter: item.chapters.length > 1 ? (item.chapters[chapterAt(item.chapters, positionSec)]?.title ?? null) : null,
    podcastId: item.podcastId,
    title: item.type === "episode" ? item.title : null,
  };
}

export interface BookmarkPlatform {
  api<T>(path: string, init?: { method: string; body?: unknown }): Promise<T>;
  getJson<T>(key: string): T | null;
  setJson(key: string, value: unknown): void;
  removeKey(key: string): void;
  toastError(message: string): void;
  /** The server turned the change down for good (a 4xx other than 401 and 429), rather than couldn't be reached. */
  refused(err: unknown): boolean;
}

type Op = { op: "upsert"; bookmark: BookmarkDto } | { op: "delete"; bookmark: BookmarkDto };

const LIST_KEY = "murmur.bookmarks";
const OUTBOX_KEY = "murmur.bookmarkOutbox";
const NONE: BookmarkDto[] = [];

const apply = (list: BookmarkDto[], o: Op) => {
  const rest = list.filter((b) => b.id !== o.bookmark.id);
  return o.op === "upsert" ? [...rest, o.bookmark] : rest;
};

const toItem = ({ id, itemType, itemId, positionSec, note, createdAt, updatedAt }: BookmarkDto): BookmarkItem => ({
  id,
  itemType,
  itemId,
  positionSec,
  note,
  createdAt,
  updatedAt,
});

export type BookmarkStore = ReturnType<typeof createBookmarkStore>;

export function createBookmarkStore(p: BookmarkPlatform) {
  let base = p.getJson<BookmarkDto[]>(LIST_KEY) ?? [];
  let outbox = p.getJson<Op[]>(OUTBOX_KEY) ?? [];
  /** Whether the server's list has come in since starting, or there are changes of our own. */
  let loaded = outbox.length > 0;
  let all: BookmarkDto[] = [];
  let byItem = new Map<string, BookmarkDto[]>();
  let byPodcast = new Map<string, BookmarkDto[]>();
  let version = 0;
  const listeners = new Set<() => void>();

  function regroup(old: Map<string, BookmarkDto[]>, keyOf: (b: BookmarkDto) => string | null) {
    const next = new Map<string, BookmarkDto[]>();
    for (const b of all) {
      const key = keyOf(b);
      if (key) addTo(next, key, b);
    }
    for (const [key, list] of next) {
      const was = old.get(key);
      if (was?.length === list.length && was.every((b, i) => b === list[i])) next.set(key, was);
    }
    return next;
  }

  function changed() {
    all = outbox.reduce(apply, base);
    all.sort((a, b) => a.positionSec - b.positionSec);
    byItem = regroup(byItem, (b) => `${b.itemType}:${b.itemId}`);
    byPodcast = regroup(byPodcast, (b) => b.podcastId);
    version += 1;
    for (const l of listeners) l();
  }
  changed();

  function queue(o: Op) {
    loaded = true;
    outbox = [...outbox, o];
    p.setJson(OUTBOX_KEY, outbox);
    changed();
    void flush();
  }

  /** Sends made since the list was last read; a read that overlaps one is stale. */
  let sent = 0;
  let sending: Promise<void> | null = null;

  /** Sends what's waiting, in order; offline it stops and keeps the rest. */
  function flush(): Promise<void> {
    // Before the block below: with nothing to send it would finish at once and leave `sending` set for good.
    if (!outbox.length) return sending ?? Promise.resolve();
    sending ??= (async () => {
      try {
        while (outbox[0]) {
          const o = outbox[0];
          try {
            if (o.op === "upsert") await p.api(apiPaths.bookmarks, { method: "PUT", body: { items: [toItem(o.bookmark)] } });
            else await p.api(apiPaths.bookmark(o.bookmark.id), { method: "DELETE" });
            base = apply(base, o);
            sent++;
          } catch (err) {
            // Only the server turning it down drops it; anything else tries again later.
            if (!p.refused(err)) return;
            p.toastError(o.op === "upsert" ? "Couldn't save the bookmark." : "Couldn't delete the bookmark.");
          }
          outbox = outbox.filter((x) => x !== o);
          p.setJson(OUTBOX_KEY, outbox);
          p.setJson(LIST_KEY, base);
          changed();
        }
      } finally {
        sending = null;
      }
    })();
    return sending;
  }

  /** Sends what's waiting, then takes the server's list as the new base. */
  async function refresh(): Promise<void> {
    await flush();
    if (outbox.length) return;
    const seen = sent;
    try {
      const list = await p.api<BookmarkDto[]>(apiPaths.bookmarks);
      if (seen !== sent) return refresh();
      base = list;
      loaded = true;
      p.setJson(LIST_KEY, base);
      changed();
    } catch {
      // The saved list stands.
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Moves on with every change, for hooks that compare snapshots. */
    version: () => version,
    /** False until the server's list has come in, so a page can show its own copy until then. */
    loaded: () => loaded,
    /** One item's bookmarks, in order. */
    forItem: (type: PlayType | undefined, id: string | undefined) => byItem.get(`${type}:${id}`) ?? NONE,
    /** Every bookmark in a podcast's episodes. */
    forPodcast: (podcastId: string) => byPodcast.get(podcastId) ?? NONE,
    add: (b: BookmarkDto) => queue({ op: "upsert", bookmark: b }),
    update(b: BookmarkDto, change: { positionSec: number; note: string | null; chapter?: string | null }) {
      queue({ op: "upsert", bookmark: { ...b, ...change, updatedAt: Date.now() } });
    },
    remove: (b: BookmarkDto) => queue({ op: "delete", bookmark: b }),
    flush,
    refresh,
    /** Drops this account's bookmarks and anything unsent, on sign-out, so they never reach the next one. */
    forget() {
      base = [];
      outbox = [];
      loaded = false;
      p.removeKey(LIST_KEY);
      p.removeKey(OUTBOX_KEY);
      changed();
    },
  };
}
