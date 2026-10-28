import type { QueueEntry, QueueRef } from "./index";
import type { RepeatMode } from "./music";
import { shuffled } from "./music";

// Up Next is one running list, like YouTube Music's: what played stays above the item playing,
// what's next sits below, and every row can be played, moved or taken out. These rules are shared
// by the web player and the app's, and work on bare refs (the server) or full entries (the players).

/** An item in the list. `added` marks what you put there yourself, as opposed to the album's own songs. */
export type UpNextRef = QueueRef & { added: boolean };
export type UpNextEntry = QueueEntry & { added: boolean };

/** Where the songs came from: the album, artist, your songs or a playlist. */
export interface UpNextSource {
  kind: "album" | "artist" | "songs" | "playlist";
  refId: string | null;
  /** "Back In Black", "AC/DC", "Your songs" or the playlist's name. */
  title: string;
}

export interface UpNextList<E extends UpNextRef = UpNextRef> {
  items: E[];
  /** The item playing. -1 when what's playing isn't in the list (a book), so all of it is still to come. */
  index: number;
  source: UpNextSource | null;
  /** The source's songs in its own order, to go back to when shuffle is turned off. */
  originalIds: string[];
  shuffled: boolean;
}

export type UpNextDto = UpNextList<UpNextEntry>;

export const EMPTY_UP_NEXT: UpNextList<never> = { items: [], index: -1, source: null, originalIds: [], shuffled: false };

const same = (a: QueueRef, b: QueueRef) => a.itemType === b.itemType && a.itemId === b.itemId;
const isSourceSong = (e: UpNextRef) => e.itemType === "track" && !e.added;

/** What's still to come after the item playing. */
export const upcoming = <E extends UpNextRef>(l: UpNextList<E>): E[] => l.items.slice(l.index + 1);

/** The item playing, if it's in the list. */
export const playingItem = <E extends UpNextRef>(l: UpNextList<E>): E | undefined => l.items[l.index];

/**
 * Starting an album, artist, your songs or a playlist: its songs replace the list, from `index`
 * (-1 for Play: the first song, or any one when shuffled). Episodes you added that haven't played
 * yet stay, after the songs.
 */
export function startMusic<E extends UpNextRef>(
  prev: UpNextList<E>,
  source: UpNextSource,
  songs: E[],
  index: number,
  shuffle: boolean,
): UpNextList<E> {
  const first = index >= 0 ? songs[index] : undefined;
  const order = shuffle ? shuffled(songs, first) : songs;
  const waiting = upcoming(prev).filter((e) => e.itemType === "episode");
  return {
    items: [...order, ...waiting],
    index: shuffle ? 0 : Math.max(0, index),
    source,
    originalIds: songs.map((s) => s.itemId),
    shuffled: shuffle,
  };
}

/**
 * Playing something from outside the list: an episode from its show, or (with null) a book. The
 * songs go, and episodes you added that haven't played yet stay after it.
 */
export function startSingle<E extends UpNextRef>(prev: UpNextList<E>, item: E | null): UpNextList<E> {
  const waiting = upcoming(prev).filter((e) => e.itemType === "episode" && !(item && same(e, item)));
  return { items: item ? [item, ...waiting] : waiting, index: item ? 0 : -1, source: null, originalIds: [], shuffled: false };
}

/**
 * Adding to Up Next. "next" plays it after the item playing and anything you added right after it;
 * "last" puts it at the end. Something already waiting moves instead of doubling up, and something
 * that already played comes down from the history.
 */
export function addItem<E extends UpNextRef>(l: UpNextList<E>, item: E, at: "next" | "last"): UpNextList<E> {
  const playing = playingItem(l);
  if (playing && same(playing, item)) return l;
  const was = l.items.findIndex((e) => same(e, item));
  const items = was < 0 ? [...l.items] : l.items.filter((_, i) => i !== was);
  let index = was >= 0 && was < l.index ? l.index - 1 : l.index;
  const entry = { ...item, added: true };
  if (at === "last") items.push(entry);
  else {
    let pos = index + 1;
    while (items[pos]?.added) pos++;
    items.splice(pos, 0, entry);
  }
  if (index >= items.length) index = items.length - 1;
  return { ...l, items, index };
}

/**
 * Takes out the item at `at`. Taking out the one playing moves on to the one after it; `play` says
 * which index to start, or null when nothing is left after it.
 */
export function removeAt<E extends UpNextRef>(l: UpNextList<E>, at: number): { list: UpNextList<E>; play: number | null } {
  const items = l.items.filter((_, i) => i !== at);
  if (at === l.index) {
    const play = at < items.length ? at : null;
    return { list: { ...l, items, index: play ?? -1 }, play };
  }
  return { list: { ...l, items, index: at < l.index ? l.index - 1 : l.index }, play: null };
}

/** Moves the item at `from` to `to`. The item playing keeps playing wherever it ends up. */
export function moveItem<E extends UpNextRef>(l: UpNextList<E>, from: number, to: number): UpNextList<E> {
  const items = [...l.items];
  const [moved] = items.splice(from, 1);
  if (!moved) return l;
  items.splice(to, 0, moved);
  const playing = playingItem(l);
  return { ...l, items, index: playing ? items.indexOf(playing) : l.index };
}

/**
 * Shuffle on: the source's songs still to come swap places at random, while what you added and
 * episodes keep theirs. Off: the source's songs after the one playing come back in its own order,
 * leaving out the ones already played.
 */
export function setShuffle<E extends UpNextRef>(l: UpNextList<E>, on: boolean): UpNextList<E> {
  if (!l.source) return { ...l, shuffled: on };
  const slots = l.items.flatMap((e, i) => (i > l.index && isSourceSong(e) ? [i] : []));
  if (on) {
    const mixed = shuffled(slots.map((i) => l.items[i]!));
    const items = [...l.items];
    slots.forEach((slot, n) => (items[slot] = mixed[n]!));
    return { ...l, items, shuffled: true };
  }
  // Carry on from the last song of the source at or before the one playing.
  const anchor = l.items.slice(0, l.index + 1).findLast(isSourceSong);
  const from = anchor ? l.originalIds.indexOf(anchor.itemId) + 1 : 0;
  const played = new Set(l.items.slice(0, l.index + 1).map((e) => `${e.itemType}:${e.itemId}`));
  const byId = new Map(l.items.filter(isSourceSong).map((e) => [e.itemId, e]));
  const next = l.originalIds
    .slice(from)
    .flatMap((id) => (played.has(`track:${id}`) ? [] : (byId.get(id) ?? [])));
  const kept = l.items.filter((e, i) => i <= l.index || !isSourceSong(e));
  // The source's songs go back where its first one waiting was, else after what you added next.
  let at = slots[0] ?? l.index + 1;
  if (!slots.length) while (kept[at]?.added) at++;
  kept.splice(at, 0, ...next);
  return { ...l, items: kept, shuffled: false };
}

/**
 * What plays after the item playing: the same one again on Repeat one (only when it ended by itself),
 * the next item, or the top of the list on Repeat all. Repeat is for songs, so callers pass "off"
 * for an episode.
 */
export function nextIndex(l: UpNextList, repeat: RepeatMode, ended: boolean): "again" | number | null {
  if (ended && repeat === "one" && l.index >= 0) return "again";
  if (l.index + 1 < l.items.length) return l.index + 1;
  return repeat === "all" && l.items.length ? 0 : null;
}

/** What Previous goes back to, or null to restart the item playing. On Repeat all the top goes round to the end. */
export function previousIndex(l: UpNextList, repeat: RepeatMode): number | null {
  if (l.index > 0) return l.index - 1;
  return l.index === 0 && repeat === "all" && l.items.length > 1 ? l.items.length - 1 : null;
}
