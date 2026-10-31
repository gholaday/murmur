import type { BookmarkDto, PlayType } from "./index";
import { pastStart } from "./shelves";

// Bookmark rules shared by the web player and the app's.

/** A bookmark lands this much listening before the tap: you tap after you hear the thing. */
export const BOOKMARK_EARLY_SEC = 10;
/** The player's bookmark icon is filled this close to one, and tapping it then acts on that one. */
export const BOOKMARK_NEAR_SEC = 15;
/** The −15s and +15s buttons on the note sheet. */
export const BOOKMARK_NUDGE_SEC = 15;
export const BOOKMARK_NOTE_MAX = 500;

/** Where a bookmark made now lands. */
export function bookmarkSpot(position: number, playing: boolean, speed: number): number {
  return Math.max(0, playing ? position - BOOKMARK_EARLY_SEC * speed : position);
}

/** The bookmark closest to `position` within reach of the player's icon, if any. */
export function bookmarkNear<T extends Pick<BookmarkDto, "positionSec">>(bookmarks: T[], position: number): T | null {
  let best: T | null = null;
  for (const b of bookmarks) {
    const gap = Math.abs(b.positionSec - position);
    if (gap <= BOOKMARK_NEAR_SEC && (!best || gap < Math.abs(best.positionSec - position))) best = b;
  }
  return best;
}

/** An id made on the device, so a retry can't double up. Unique per person, which is all it needs. */
export const newBookmarkId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** The player's third tile. Songs have none; ads live in the ⋯ menu. */
export function thirdTile(type: PlayType, multiChapter: boolean): "chapters" | "bookmarks" | null {
  if (type === "track") return null;
  return multiChapter ? "chapters" : "bookmarks";
}

// ---------- Go back ----------

/** A jump shorter than this doesn't offer Go back. */
export const GO_BACK_MIN_SEC = 30;
/** After this much listening from the jump, the new spot is your place. */
export const GO_BACK_HOLD_SEC = 300;

/**
 * Your real place while you listen somewhere else after opening a bookmark. Progress isn't saved
 * while one is held, so Continue listening and other devices keep the real place.
 */
export interface JumpHold {
  type: PlayType;
  id: string;
  /** The real place. */
  returnTo: number;
  /** Where the first jump landed. */
  from: number;
  /** Seconds listened since. */
  heard: number;
}

/** Whether going from `from` to `to` offers Go back: there's a real place to return to, and it's far enough. */
export const offersGoBack = (from: number, to: number) => pastStart(from) && Math.abs(from - to) > GO_BACK_MIN_SEC;

/**
 * Whether a hold is over: listened long enough, or a jump backwards has played up to the real
 * place. The first second doesn't count for that, since a position sent before the jump landed
 * (from a Chromecast, say) can still read the old place.
 */
export const holdEnded = (hold: JumpHold, position: number) =>
  hold.heard >= GO_BACK_HOLD_SEC || (hold.heard >= 1 && hold.from < hold.returnTo && position >= hold.returnTo);
