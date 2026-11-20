"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { apiPaths, errorText, type MusicLikeChange } from "@murmur/shared/client";
import { api } from "../api";
import { HeartIcon } from "../icons";

// Likes changed in this browser since the page's data was read, by "track:<id>" or "album:<id>".
// Every heart for the same song or album reads them, so liking a song on its album page also
// fills the player's heart, which otherwise knows only how it was when the song was queued.
// A new page brings fresh data, so they're forgotten on every page change (see forgetLikes).
const known = new Map<string, boolean>();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const notify = () => {
  for (const fn of listeners) fn();
};

// Each tap's number, by key, so a failed tap only goes back if no newer tap came after it.
let taps = 0;
const lastTap = new Map<string, number>();

const keysOf = (change: MusicLikeChange) => [...(change.trackIds ?? []).map((id) => `track:${id}`), ...(change.albumIds ?? []).map((id) => `album:${id}`)];

/** Records likes as they are now, for every heart showing them. */
function noteLikes(change: MusicLikeChange, on: boolean) {
  for (const k of keysOf(change)) known.set(k, on);
  notify();
}

/** Drops what this page learned; the next page's data is newer. */
export function forgetLikes() {
  if (!known.size) return;
  known.clear();
  notify();
}

/** How many taps there have been, to tell whether one came during a fetch (see noteFetchedLike). */
export const likeTaps = () => taps;

/** A song's like as the server just said it, unless it was tapped since the fetch began (`since`, from likeTaps). */
export function noteFetchedLike(trackId: string, liked: boolean, since: number) {
  if ((lastTap.get(`track:${trackId}`) ?? 0) > since) return;
  noteLikes({ trackIds: [trackId] }, liked);
}

/** Likes (`on`) or unlikes songs and albums; resolves false when it failed. */
function useLikeChange(): (on: boolean, change: MusicLikeChange) => Promise<boolean> {
  const router = useRouter();
  return async (on, change) => {
    const tap = ++taps;
    for (const k of keysOf(change)) lastTap.set(k, tap);
    noteLikes(change, on);
    try {
      await api(apiPaths.musicLikes, { method: on ? "PUT" : "DELETE", body: change });
      router.refresh();
      return true;
    } catch (err) {
      // Put back only what no later tap changed again.
      const mine = keysOf(change).filter((k) => lastTap.get(k) === tap);
      for (const k of mine) known.set(k, !on);
      notify();
      toast.error(errorText(err, on ? "Couldn't like that." : "Couldn't unlike that."));
      return false;
    }
  };
}

/** The heart on a song or album: fills at once, and goes back if the server says no. */
export function LikeButton({
  title,
  liked,
  change,
  size = 20,
  round,
}: {
  title: string;
  /** As the page's data has it; a like changed since then wins. */
  liked: boolean;
  change: MusicLikeChange;
  size?: number;
  /** The round button beside Play, rather than a plain icon. */
  round?: boolean;
}) {
  const send = useLikeChange();
  const key = keysOf(change)[0]!;
  const shown = useSyncExternalStore(
    subscribe,
    () => known.get(key) ?? liked,
    () => liked,
  );
  return (
    <button
      type="button"
      className={`${round ? "btn-round" : "icon-btn"} like-btn${shown ? " on" : ""}`}
      aria-pressed={shown}
      aria-label={shown ? `Unlike ${title}` : `Like ${title}`}
      onClick={() => void send(!shown, change)}
    >
      <HeartIcon size={size} filled={shown} />
    </button>
  );
}
