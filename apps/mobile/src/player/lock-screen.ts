import { type AudioLockScreenOptions, type AudioMetadata, type AudioPlayer } from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";
import { chapterAt, type SkipSettings } from "@murmur/shared/client";
import { absolute, authHeaders } from "@/lib/api";
import { savedArt } from "@/lib/downloads";
import { isIOS } from "@/lib/platform";
import type { Playable } from "./engine";

/**
 * A server picture as a file on the phone, for the media notification, which can't send our
 * sign-in with its own request. Audio and video both use it.
 */
export async function artworkFile(path: string | null): Promise<string | undefined> {
  if (!path) return undefined;
  const saved = savedArt(path);
  if (saved) return saved;
  // Two asks for the same picture at once share one download; a second would find the file half-made.
  let pending = artworkLoads.get(path);
  if (!pending) {
    pending = fetchArtwork(path).finally(() => artworkLoads.delete(path));
    artworkLoads.set(path, pending);
  }
  return pending;
}

const artworkLoads = new Map<string, Promise<string | undefined>>();

async function fetchArtwork(path: string): Promise<string | undefined> {
  try {
    const dir = new Directory(Paths.cache, "artwork");
    dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, `${path.replace(/\W+/g, "-")}.img`);
    if (!file.exists) await File.downloadFileAsync(absolute(path), file, { headers: authHeaders() });
    return file.uri;
  } catch {
    return undefined;
  }
}

/** What the lock screen reads from the engine. */
interface NowPlaying {
  item(): Playable | null;
  position(): number;
  skip(): SkipSettings;
  player(): AudioPlayer;
  casting(): boolean;
}

/** The lock screen and Control Center (Android's media notification). */
export function createLockScreen(now: NowPlaying) {
  /** The player they're bound to, and whether they show song buttons. */
  let on: AudioPlayer | null = null;
  let songs = false;
  /** The chapter shown, or -1 for an item without chapters. */
  let shownChapter = -1;
  let shownMetadata: AudioMetadata | undefined;

  /**
   * Songs get previous and next on the lock screen; books and episodes get the skip buttons,
   * jumping as far as the player's own (iOS; Android has its own).
   */
  const options = (): AudioLockScreenOptions => {
    const { back, forward } = now.skip();
    return now.item()?.type === "track"
      ? { showSeekBackward: false, showSeekForward: false, showPreviousTrack: true, showNextTrack: true }
      : { showSeekBackward: true, showSeekForward: true, seekBackwardInterval: back, seekForwardInterval: forward, showBookmark: true };
  };

  /** Shows the item. A book with chapters shows the chapter as the title and the book under it. */
  async function show(it: Playable) {
    // Google's Cast notification takes over while casting.
    if (now.casting()) return;
    const ci = it.chapters.length > 1 ? chapterAt(it.chapters, now.position()) : -1;
    shownChapter = ci;
    const chapter = ci >= 0 ? it.chapters[ci] : undefined;
    const metadata: AudioMetadata = {
      title: chapter?.title ?? it.title,
      artist: chapter ? it.title : (it.subtitle ?? undefined),
      albumTitle: it.type === "book" ? it.title : (it.album?.title ?? it.subtitle ?? undefined),
      artworkUrl: await artworkFile(it.coverPathLarge),
    };
    const cur = now.item();
    if ((cur !== it && cur?.id !== it.id) || now.casting()) return;
    shownMetadata = metadata;
    // A new song can be on the other player, and songs show different buttons, so either means
    // setting the controls up again rather than just changing the text.
    const player = now.player();
    const song = it.type === "track";
    if (on === player && songs === song) player.updateLockScreenMetadata(metadata);
    else player.setActiveForLockScreen(true, metadata, options());
    on = player;
    songs = song;
  }

  return {
    show,
    /** It names the chapter playing, so it changes as a chapter ends. */
    moved(it: Playable, position: number) {
      if (on && it.chapters.length > 1 && chapterAt(it.chapters, position) !== shownChapter) void show(it);
    },
    /** iOS reads the intervals when the controls are set up, so set them up again. */
    skipChanged() {
      if (isIOS && on && on === now.player()) on.setActiveForLockScreen(true, shownMetadata, options());
    },
    clear() {
      on?.clearLockScreenControls();
      on = null;
      shownChapter = -1;
      shownMetadata = undefined;
    },
  };
}
