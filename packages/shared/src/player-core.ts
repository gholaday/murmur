// The player both clients run: what plays, Up Next, saving your place, ads, the sleep timer, the
// hold after a jump to a bookmark, and music's counting and gapless hand-over. Each client gives it
// a `PlayerPlatform` for the parts that differ (its audio, storage, requests and toasts) and feeds
// the audio's events back in through the `loaded`, `time`, `playingChanged`, `ended` and `failed`
// calls. No React here: the web wraps it in a context, the app in its module stores.

import { adModeFor, type AdPrefs, adToSkip, playedThrough } from "./ads";
import { apiPaths } from "./api-paths";
import { holdEnded, type JumpHold, offersGoBack } from "./bookmarks";
import type { BookDetail, ChapterDto, EpisodeAdsDto, EpisodeWithShow, PlayType, ProgressItem, QueueRef, UpNextInput, UserPrefs } from "./index";
import { albumCover, PLAY_COUNTS_AFTER_SEC, type RepeatMode, type TrackDto } from "./music";
import {
  ADS_POLL_MS,
  chapterAt,
  clampSpeed,
  DEFAULT_SKIP,
  fitChapters,
  NOW_PLAYING_KEY,
  nextRepeatMode,
  parseSkip,
  type PlayRef,
  SAVE_EVERY_MS,
  SKIP_KEY,
  type SkipSettings,
  type SleepTimer,
} from "./player";
import {
  EMPTY_UP_NEXT,
  moveItem,
  nextIndex,
  previousIndex,
  removeAt,
  setShuffle,
  startMusic,
  startSingle,
  type UpNextDto,
  type UpNextEntry,
  type UpNextList,
  type UpNextSource,
} from "./up-next";

// ---------- What plays ----------

export interface PlayableFile {
  /** An API path; the client makes it a full address. */
  path: string;
  startSec: number;
  durationSec: number;
}

/** Anything the player can play: a book (one or more files on one timeline), an episode or a song. */
export interface Playable {
  type: PlayType;
  id: string;
  title: string;
  subtitle: string | null;
  coverPath: string | null;
  coverPathLarge: string | null;
  color: string | null;
  durationSec: number;
  files: PlayableFile[];
  chapters: ChapterDto[];
  podcastId: string | null;
  /** A song's album, for its cover colour, "Go to album" and the lock screen. */
  album: { id: string; title: string } | null;
  /** Where playback starts if it isn't already loaded. */
  startAt: number;
  speed: number;
}

export function bookToPlayable(b: BookDetail): Playable {
  return {
    type: "book",
    id: b.id,
    title: b.title,
    subtitle: b.author,
    coverPath: b.coverHash ? apiPaths.coverUrl(b.id, b.coverHash, 200) : null,
    coverPathLarge: b.coverHash ? apiPaths.coverUrl(b.id, b.coverHash, 600) : null,
    color: b.coverColor,
    durationSec: b.durationSec,
    files: b.files.map((f) => ({ path: apiPaths.bookFileUrl(b.id, f.index), startSec: f.startSec, durationSec: f.durationSec })),
    chapters: b.chapters,
    podcastId: null,
    album: null,
    startAt: b.progress && !b.progress.finished ? b.progress.positionSec : 0,
    speed: clampSpeed(b.progress?.speed ?? 1),
  };
}

export function episodeToPlayable(e: EpisodeWithShow): Playable {
  const dur = e.durationSec ?? 0;
  return {
    type: "episode",
    id: e.id,
    title: e.title,
    subtitle: e.podcastTitle,
    coverPath: e.podcastCoverHash ? apiPaths.podcastCoverUrl(e.podcastId, e.podcastCoverHash, 200) : null,
    coverPathLarge: e.podcastCoverHash ? apiPaths.podcastCoverUrl(e.podcastId, e.podcastCoverHash, 600) : null,
    color: e.podcastCoverColor,
    durationSec: dur,
    files: [{ path: apiPaths.episodeUrl(e.id), startSec: 0, durationSec: dur }],
    chapters: [],
    podcastId: e.podcastId,
    album: null,
    startAt: e.progress && !e.progress.finished ? e.progress.positionSec : 0,
    speed: clampSpeed(e.speed),
  };
}

/** A song: always from the start, at 1x, with no position kept. */
export function trackToPlayable(t: TrackDto): Playable {
  return {
    type: "track",
    id: t.id,
    title: t.title,
    subtitle: t.artist,
    coverPath: albumCover(t.albumId, t.coverHash),
    coverPathLarge: albumCover(t.albumId, t.coverHash, 600),
    color: null,
    durationSec: t.durationSec,
    files: [{ path: apiPaths.trackUrl(t.id), startSec: 0, durationSec: t.durationSec }],
    chapters: [],
    podcastId: null,
    album: { id: t.albumId, title: t.album },
    startAt: 0,
    speed: 1,
  };
}

export const entryToPlayable = (e: UpNextEntry): Playable => (e.itemType === "track" ? trackToPlayable(e.track) : episodeToPlayable(e.episode));

/** Where music plays from, as the album, artist and Songs screens hand it to the player. */
export interface MusicSource {
  kind: UpNextSource["kind"];
  refId: string | null;
  title: string;
  tracks: TrackDto[];
}

/** What was playing, with where it had got to: details fetched later may be behind. */
export type SavedPlace = PlayRef & { at?: number };

const trackEntry = (track: TrackDto): UpNextEntry => ({ itemType: "track", itemId: track.id, added: false, track });
const toRefs = (l: UpNextList): UpNextInput => ({ ...l, items: l.items.map(({ itemType, itemId, added }) => ({ itemType, itemId, added })) });
const sameRef = (a: QueueRef, b: QueueRef) => a.itemType === b.itemType && a.itemId === b.itemId;
const keyOf = (it: Playable | null) => (it ? `${it.type}:${it.id}` : null);

/** Start the next song loading this long before the current one ends, so it follows without a gap. */
const PRELOAD_SEC = 10;
/** Previous restarts the item once it's this far in, like a CD player. */
const RESTART_AFTER_SEC = 3;
export const PLAY_FAILED = "Couldn't play this. Check your connection and try again.";

// ---------- State ----------

export interface PlayerState {
  item: Playable | null;
  playing: boolean;
  loading: boolean;
  error: string | null;
  speed: number;
  sleep: SleepTimer;
  skip: SkipSettings;
  /** Up Next: what played, what's playing (`index`) and what's next. A book isn't in it (index -1). */
  upNext: UpNextDto;
  /** False until Up Next has come back from the server once, so screens don't flash "empty". */
  upNextLoaded: boolean;
  /** Ad detection for the current episode; null for anything else and until the server answers. */
  ads: EpisodeAdsDto | null;
  /** Your shuffle and repeat settings for music, kept on the server so every device shares them. */
  shuffle: boolean;
  repeat: RepeatMode;
  /** Your real place while a jump to a bookmark is on hold, for the Go back card; else null. */
  goBackTo: number | null;
}

export const isCurrent = (s: PlayerState, type: PlayType, id: string) => s.item?.type === type && s.item.id === id;

/** Whether the music playing comes from this album, artist, playlist or your songs. */
export const isPlayingFrom = (s: PlayerState, kind: UpNextSource["kind"], refId: string | null) =>
  s.item?.type === "track" && s.upNext.source?.kind === kind && s.upNext.source.refId === refId;

/** Whether `ref` is still to come in Up Next (not played already, not playing). */
export const isWaiting = (l: UpNextList, ref: QueueRef) => l.items.some((e, i) => i > l.index && sameRef(e, ref));

// ---------- What each client provides ----------

/** The audio itself: an <audio> element or expo-audio, or the Chromecast while casting. */
export interface PlayerMedia {
  readonly playing: boolean;
  /** The loaded file's length in seconds, 0 until known. */
  readonly duration: number;
  /**
   * Loads file `fileIndex` of `it` and, once it's loaded, seeks to `inFileSec`, sets `speed` and
   * plays if `autoplay`. Until that seek lands it reports no `time`.
   */
  load(it: Playable, fileIndex: number, inFileSec: number, autoplay: boolean, speed: number): void;
  play(): void;
  pause(): void;
  seekTo(inFileSec: number): void;
  setRate(rate: number): void;
  /** Starts a spare player loading this song; false when there's no spare (while casting). */
  preload(it: Playable): boolean;
  /** Plays the spare player's song at once and makes it the current player (the gapless hand-over); false if it holds none. */
  swapToPreloaded(): boolean;
  dropPreloaded(): void;
  /** Stops and empties the player. */
  unload(): void;
}

export interface PlayerPlatform {
  media: PlayerMedia;
  api<T>(path: string, init?: { method: string; body?: unknown }): Promise<T>;
  /** A toast, with an Undo-style action when `action` is given. */
  toast(message: string, action?: { label: string; run: () => void }): void;
  toastError(message: string): void;
  getJson<T>(key: string): T | null;
  setJson(key: string, value: unknown): void;
  removeKey(key: string): void;
  /** Saves a place (straight away or through an outbox); `refreshLists` is for changes lists show. */
  saveProgress(entry: ProgressItem, refreshLists: boolean): Promise<void> | void;
  /** Saves the listening time gathered so far, sending it at once when `paused` (else it can wait for the next save). */
  saveListening(paused: boolean): Promise<void> | void;
  addListening(type: PlayType, id: string, wallSec: number, movedSec: number, speed: number): void;
  /** A song was heard long enough to count as played. */
  countPlay(trackId: string, source: { kind: UpNextSource["kind"]; refId: string | null } | null): void;
  /** An item's details: from the server, or what the device has saved when it's offline. */
  loadPlayable(ref: PlayRef): Promise<Playable>;
  adPrefs(): AdPrefs;
  /** Ad times saved with a download, for when the server can't be reached. */
  savedAds?(episodeId: string): EpisodeAdsDto | null;
  adsLoaded?(episodeId: string, ads: EpisodeAdsDto): void;
  upNextChanged?(l: UpNextDto): void;
  musicPrefsChanged?(prefs: Pick<UserPrefs, "shuffle" | "repeat">): void;
  /** A new item is loaded (or none): lock screen, notification and media session. */
  itemShown?(it: Playable | null): void;
  positionMoved?(it: Playable, sec: number): void;
  skipChanged?(): void;
  /** A tap's feedback on the controls that have it. */
  haptic?(): void;
  /** Milliseconds, for timing ticks. */
  now(): number;
}

export type PlayerCore = ReturnType<typeof createPlayerCore>;

export function createPlayerCore(platform: PlayerPlatform) {
  const media = platform.media;

  let state: PlayerState = {
    item: null,
    playing: false,
    loading: false,
    error: null,
    speed: 1,
    sleep: { mode: "off" },
    skip: DEFAULT_SKIP,
    upNext: EMPTY_UP_NEXT,
    upNextLoaded: false,
    ads: null,
    shuffle: false,
    repeat: "off",
    goBackTo: null,
  };
  const listeners = new Set<() => void>();
  let position = 0;
  const positionListeners = new Set<() => void>();

  function set(change: Partial<PlayerState>) {
    state = { ...state, ...change };
    if ("item" in change) {
      // Go back belongs to one item. Leaving it saves nothing: the real place is already saved.
      if (hold && !isCurrent(state, hold.type, hold.id)) {
        hold = null;
        state = { ...state, goBackTo: null };
      }
      watchAds();
      watchChapters();
    }
    for (const l of listeners) l();
  }

  function setPosition(p: number) {
    if (p === position) return;
    position = p;
    for (const l of positionListeners) l();
    if (state.item) platform.positionMoved?.(state.item, p);
  }

  // ---------- Ads and chapters ----------

  let adsFor: string | null = null;
  let adsTimer: ReturnType<typeof setTimeout> | undefined;
  /** Ads (by index) you chose to hear with Undo, so auto-skip leaves them alone. */
  let adsAllowed = new Set<number>();

  /**
   * Asks for the current episode's ad times when the item changes, and again while its scan is
   * still running. Any failure just means no marks, never a playback problem.
   */
  function watchAds() {
    const it = state.item;
    const key = keyOf(it);
    if (key === adsFor) return;
    adsFor = key;
    clearTimeout(adsTimer);
    adsAllowed = new Set();
    state = { ...state, ads: null };
    if (!it || it.type !== "episode") return;
    const fetchAds = async () => {
      try {
        const info = await platform.api<EpisodeAdsDto>(apiPaths.episodeAds(it.id));
        if (adsFor !== key) return;
        set({ ads: info });
        platform.adsLoaded?.(it.id, info);
        if (!info.enabled || info.status === "done" || info.status === "failed") return;
      } catch {
        if (adsFor !== key) return;
        const saved = platform.savedAds?.(it.id);
        if (!state.ads && saved) set({ ads: saved });
      }
      adsTimer = setTimeout(() => void fetchAds(), ADS_POLL_MS);
    };
    void fetchAds();
  }

  let chaptersFor: string | null = null;

  /** An episode's chapters, which the server may take a moment to find. None just means a plain scrubber. */
  function watchChapters() {
    const it = state.item;
    const key = keyOf(it);
    if (key === chaptersFor) return;
    chaptersFor = key;
    if (!it || it.type !== "episode") return;
    platform
      .api<ChapterDto[]>(apiPaths.episodeChapters(it.id))
      .then((chapters) => {
        const cur = state.item;
        if (chaptersFor !== key || !chapters.length || !cur || keyOf(cur) !== key) return;
        set({ item: { ...cur, chapters: fitChapters(chapters, cur.durationSec) } });
      })
      .catch(() => undefined);
  }

  /**
   * Skips the break when a move forward from `prev` to `pos` crossed an ad's start and landed
   * inside it, in Auto-skip mode. Undo goes back to `undoTo` (or the ad's start) and lets it play.
   */
  function skipAdCrossed(prev: number, pos: number, undoTo?: number) {
    const spans = state.ads?.enabled ? state.ads.ads : [];
    const it = state.item;
    if (!spans.length || !it || adModeFor(platform.adPrefs(), it.podcastId) !== "auto") return;
    const brk = adToSkip(spans, prev, pos, adsAllowed, undoTo);
    if (!brk) return;
    seek(brk.endSec);
    platform.toast(brk.indexes.length > 1 ? `Skipped ${brk.indexes.length} ads` : "Skipped ad", {
      label: "Undo",
      run: () => {
        for (const idx of brk.indexes) adsAllowed.add(idx);
        seek(brk.undoTo);
      },
    });
  }

  // ---------- Loading ----------

  let fileIndex = 0;
  /** The file asked for last has loaded and its restore seek landed, so a seek can go straight to it. */
  let fileReady = false;
  /** Whether that load was asked to play once ready; a seek before then keeps the wish. */
  let loadAutoplay = false;
  let lastSaved = 0;
  /** Wall time of the last tick while playing; 0 after a pause, so a gap isn't counted. */
  let lastTickAt = 0;
  let lastTickKey: string | null = null;
  /** Seconds of the current song heard, toward counting it as played; sent once per play. */
  let heardSec = 0;
  let counted = false;
  /** The song the spare player has loaded, ready to go. */
  let preloaded: string | null = null;

  const fileAt = (it: Playable, sec: number) => Math.max(0, it.files.findLastIndex((f) => f.startSec <= sec));
  const fileStart = (it: Playable) => it.files[fileIndex]?.startSec ?? 0;

  function load(it: Playable, at: number, autoplay: boolean) {
    const idx = fileAt(it, at);
    fileIndex = idx;
    fileReady = false;
    loadAutoplay = autoplay;
    lastTickAt = 0;
    setPosition(at);
    set({ error: null, loading: true });
    media.load(it, idx, at - (it.files[idx]?.startSec ?? 0), autoplay, state.speed);
  }

  function dropPreloaded() {
    if (!preloaded) return;
    preloaded = null;
    media.dropPreloaded();
  }

  function startItem(it: Playable) {
    heardSec = 0;
    counted = false;
    // A timer set for what was playing doesn't carry over.
    if (state.sleep.mode !== "off") setSleep({ mode: "off" });
    set({ item: it, speed: it.speed });
    platform.setJson(NOW_PLAYING_KEY, { itemType: it.type, itemId: it.id } satisfies SavedPlace);
    platform.itemShown?.(it);
  }

  // ---------- Progress ----------

  /** Saves where the item is. `refreshLists` asks lists showing played state to catch up. */
  function save(finished = false, refreshLists = finished || !state.playing): Promise<void> {
    const it = state.item;
    if (!it) return Promise.resolve();
    if (finished) endHold();
    lastSaved = platform.now();
    // Songs keep no position, and a hold leaves the real place alone; only the listening time goes up.
    if (it.type === "track" || hold) return Promise.resolve(platform.saveListening(!state.playing));
    const dur = it.durationSec || media.duration || 0;
    const at = finished ? dur : position;
    platform.setJson(NOW_PLAYING_KEY, { itemType: it.type, itemId: it.id, at: finished ? 0 : at } satisfies SavedPlace);
    return Promise.resolve(
      platform.saveProgress(
        {
          itemType: it.type,
          itemId: it.id,
          positionSec: at,
          durationSec: Number.isFinite(dur) ? dur : 0,
          finished,
          speed: state.speed,
          updatedAt: Date.now(),
        },
        refreshLists,
      ),
    );
  }

  // ---------- Events from the audio ----------

  /** The file loaded and its restore seek landed. Feeds often misstate an episode's length; trust the file. */
  function loaded(durationSec: number) {
    const it = state.item;
    fileReady = true;
    set({ loading: false });
    if (it && it.type === "episode" && Number.isFinite(durationSec) && durationSec > 0 && Math.abs(it.durationSec - durationSec) > 1) {
      set({
        item: { ...it, durationSec, files: [{ ...it.files[0]!, durationSec }], chapters: fitChapters(it.chapters, durationSec) },
      });
    }
  }

  /** Where the loaded file has got to, several times a second. */
  function time(inFileSec: number, playing: boolean) {
    const it = state.item;
    if (!it) return;
    const pos = fileStart(it) + inFileSec;
    const prev = position;
    setPosition(pos);
    const now = platform.now();
    const key = keyOf(it);
    if (playing && lastTickAt && lastTickKey === key) {
      const elapsed = (now - lastTickAt) / 1000;
      if (playedThrough(prev, pos, elapsed, state.speed)) skipAdCrossed(prev, pos);
      platform.addListening(it.type, it.id, elapsed, position - prev, state.speed);
      if (it.type === "track") musicTick(it, position, Math.min(elapsed, position - prev));
      // Time played, not time passed, so a phone left paused overnight doesn't end a hold.
      if (hold) hold.heard += Math.min(elapsed, 5);
    }
    lastTickAt = playing ? now : 0;
    lastTickKey = key;
    if (hold && holdEnded(hold, position)) stayHere();
    if (playing && now - lastSaved > SAVE_EVERY_MS) void save();
    const sl = state.sleep;
    if (sl.mode === "chapter" && position >= sl.endSec - 0.3) {
      media.pause();
      set({ sleep: { mode: "off" } });
    }
  }

  function loadingChanged(loading: boolean) {
    if (loading !== state.loading) set({ loading });
  }

  /** Playing or paused. A pause saves, unless it's the end, which `ended` saves. */
  function playingChanged(playing: boolean) {
    if (playing === state.playing) return;
    const was = state.playing;
    set({ playing });
    if (!playing) lastTickAt = 0;
    const it = state.item;
    if (!was || playing || !it) return;
    const lastFile = it.files[it.files.length - 1];
    // A pause right at the very end is the finish, which `ended` saves.
    if (fileIndex === it.files.length - 1 && lastFile && lastFile.durationSec > 0 && position >= lastFile.startSec + lastFile.durationSec - 1) return;
    void save();
  }

  /** The loaded file played to its end: a book's next file, else what follows the item. */
  function ended() {
    const it = state.item;
    if (!it) return;
    const next = fileIndex + 1;
    if (next < it.files.length) return load(it, it.files[next]!.startSec, true);
    if (it.type === "track") {
      void save();
      // "End of song" on the sleep timer stops here rather than going on.
      if (state.sleep.mode === "chapter") return set({ sleep: { mode: "off" } });
      return playNext(nextIndex(state.upNext, state.repeat, true));
    }
    void save(true);
    // A book ends there; nothing starts on its own. An episode goes on down Up Next (repeat is for songs).
    if (it.type === "episode") playNext(nextIndex(state.upNext, "off", true));
  }

  function failed(message = PLAY_FAILED) {
    if (!state.item) return;
    set({ loading: false, playing: false, error: message });
  }

  // ---------- Music ----------

  /** While a song plays: count it once heard long enough, and preload the next one near its end. */
  function musicTick(it: Playable, pos: number, heard: number) {
    if (heard > 0 && heard < 5) heardSec += heard;
    const dur = it.durationSec || media.duration || 0;
    const needed = dur > 0 ? Math.min(PLAY_COUNTS_AFTER_SEC, dur / 2) : PLAY_COUNTS_AFTER_SEC;
    if (!counted && heardSec >= needed) {
      counted = true;
      // Where it was played from, for Jump back in.
      const source = state.upNext.source;
      platform.countPlay(it.id, source ? { kind: source.kind, refId: source.refId } : null);
    }
    if (!(dur > 0 && dur - pos < PRELOAD_SEC)) return;
    const next = nextIndex(state.upNext, state.repeat, true);
    const e = typeof next === "number" ? state.upNext.items[next] : undefined;
    if (e?.itemType === "track" && preloaded !== e.itemId && media.preload(trackToPlayable(e.track))) preloaded = e.itemId;
  }

  /** Shows and saves `l`, and plays its item at `l.index`: from the spare player when it preloaded that song. */
  function go(l: UpNextDto, saveAs: "list" | "index") {
    const e = l.items[l.index];
    if (!e) return;
    setList(l, saveAs);
    const it = entryToPlayable(e);
    // The gapless hand-over, when the spare player already has the song loaded.
    if (e.itemType === "track" && preloaded === e.itemId && media.swapToPreloaded()) {
      preloaded = null;
      fileIndex = 0;
      fileReady = true;
      lastTickAt = 0;
      heardSec = 0;
      counted = false;
      setPosition(0);
      // "End of song" was for the one that just ended; a plain timer carries on.
      set({ item: it, speed: 1, error: null, ...(state.sleep.mode === "chapter" ? { sleep: { mode: "off" } as const } : {}) });
      platform.setJson(NOW_PLAYING_KEY, { itemType: it.type, itemId: it.id } satisfies SavedPlace);
      platform.itemShown?.(it);
    } else {
      dropPreloaded();
      // Songs play from the start; an episode carries on where you left it.
      play(it, e.itemType === "track" ? 0 : undefined, true);
    }
  }

  const playAt = (index: number) => go({ ...state.upNext, index }, "index");

  /**
   * Starts music from an album, an artist or a list of songs, from song `index` (-1 for Play: the
   * first song, or any song with shuffle on). Its songs take over Up Next; waiting episodes stay
   * after them. `shuffle` true turns shuffle on first, for the Shuffle buttons.
   */
  function playMusic(source: MusicSource, index: number, shuffle = false) {
    if (!source.tracks.length) return;
    if (shuffle && !state.shuffle) setMusicPrefs({ shuffle: true }, true);
    const { kind, refId, title } = source;
    dropPreloaded();
    go(startMusic(state.upNext, { kind, refId, title }, source.tracks.map(trackEntry), index, shuffle || state.shuffle), "list");
  }

  /** Plays what `nextIndex` picked: the same song again, or another item. */
  function playNext(next: "again" | number | null) {
    if (next === null) return;
    if (next !== "again") return playAt(next);
    heardSec = 0;
    counted = false;
    seek(0);
    media.play();
  }

  /**
   * Previous and next for songs and episodes: previous restarts the item once it's a few seconds
   * in. Repeat is for songs; an episode steps through Up Next, and past either end moves to the
   * episode beside it in its show's list.
   */
  function trackStep(dir: -1 | 1) {
    const it = state.item;
    if (!it || it.type === "book") return;
    platform.haptic?.();
    const l = state.upNext;
    const repeat = it.type === "track" ? state.repeat : "off";
    if (dir === -1 && position > RESTART_AFTER_SEC) return seek(0);
    // Skipping on Repeat one moves on, so repeat drops to the whole list.
    if (dir === 1 && repeat === "one") setMusicPrefs({ repeat: "all" }, true);
    const index = l.index < 0 ? null : dir === 1 ? nextIndex(l, repeat, false) : previousIndex(l, repeat);
    if (typeof index === "number") return playAt(index);
    if (it.type === "track") return dir === -1 ? seek(0) : undefined;
    void platform.api<{ id: string | null }>(apiPaths.episodeNeighbor(it.id, dir)).then(
      ({ id }) => (id ? playRef({ itemType: "episode", itemId: id }) : dir === -1 ? seek(0) : undefined),
      () => undefined,
    );
  }

  /** Sets shuffle and repeat here, and on the server when `persist`. */
  function setMusicPrefs(prefs: { shuffle?: boolean; repeat?: RepeatMode }, persist: boolean) {
    set(prefs);
    if (!persist) return;
    platform.musicPrefsChanged?.({ shuffle: state.shuffle, repeat: state.repeat });
    void platform.api(apiPaths.prefs, { method: "PUT", body: prefs }).catch(() => undefined);
  }

  /** Turns shuffle on or off, reordering the album's or list's songs still to come. */
  function toggleShuffle() {
    platform.haptic?.();
    setMusicPrefs({ shuffle: !state.shuffle }, true);
    if (state.upNext.source) setList(setShuffle(state.upNext, state.shuffle), "list");
  }

  /** Repeat off, then all, then one. */
  function cycleRepeat() {
    platform.haptic?.();
    setMusicPrefs({ repeat: nextRepeatMode(state.repeat) }, true);
  }

  // ---------- Up Next ----------

  /** Shows a changed list at once and saves it: "list" sends the whole list, "index" only where it's at. */
  function setList(l: UpNextDto, saveAs: "list" | "index" | false) {
    set({ upNext: l, upNextLoaded: true });
    platform.upNextChanged?.(l);
    if (saveAs === "index") void platform.api(apiPaths.upNext, { method: "PATCH", body: { index: l.index } }).catch(() => undefined);
    // A change you made (not just moving along the list) says so when it didn't save.
    if (saveAs === "list") void platform.api(apiPaths.upNext, { method: "PUT", body: toRefs(l) }).catch(() => platform.toastError("Couldn't save the queue."));
  }

  async function refreshUpNext() {
    try {
      setList(await platform.api<UpNextDto>(apiPaths.upNext), false);
    } catch {
      // Keep what we have; offline, that's the honest answer.
      set({ upNextLoaded: true });
    }
  }

  /** Saves a list with an item this device has no details for yet (a new episode), and shows the server's copy. */
  async function putRefs(l: UpNextInput) {
    setList(await platform.api<UpNextDto>(apiPaths.upNext, { method: "PUT", body: l }), false);
  }

  /** Adds one item, or several in order (an album): "next" after what's playing, or "last". */
  async function addToUpNext(refs: QueueRef | QueueRef[], at: "next" | "last") {
    const body = Array.isArray(refs) ? { items: refs, at } : { ...refs, at };
    setList(await platform.api<UpNextDto>(apiPaths.upNext, { method: "POST", body }), false);
  }

  /** Takes out the item at `index`. Taking out the one playing moves on, or stops when nothing comes after it. */
  function removeFromUpNext(index: number) {
    const was = state.upNext.index;
    const { list, play: next } = removeAt(state.upNext, index);
    if (next !== null) return go(list, "list");
    setList(list, "list");
    if (index === was) void stop();
  }

  const moveUpNext = (from: number, to: number) => setList(moveItem(state.upNext, from, to), "list");

  /** Empties what's still to come; what played and the item playing stay. */
  const clearUpNext = () => setList({ ...state.upNext, items: state.upNext.items.slice(0, state.upNext.index + 1) }, "list");

  /** Puts back a list from before a change, for Undo. */
  const restoreUpNext = (l: UpNextDto) => setList(l, "list");

  /** Takes `ref` out of what's still to come. */
  function removeWaiting(ref: QueueRef) {
    const l = state.upNext;
    const at = l.items.findIndex((e, i) => i > l.index && sameRef(e, ref));
    if (at >= 0) removeFromUpNext(at);
  }

  // ---------- Controls ----------

  /**
   * Loads and plays `it`, resuming where you left off unless `startAt` is given. `fromList` is for
   * Up Next's own items, which leave the list as it is; a book, or an episode from its show, takes
   * over: the songs leave Up Next and waiting episodes stay.
   */
  function play(it: Playable, startAt?: number, fromList = false) {
    const cur = state.item;
    if (cur && cur.type === it.type && cur.id === it.id) {
      // After an error the player is stuck, so play loads it again.
      if (state.error) return load(cur, startAt ?? position, true);
      if (startAt !== undefined) seek(startAt);
      media.play();
      return;
    }
    if (cur && state.playing) void save();
    startItem(it);
    load(it, startAt ?? it.startAt, true);
    if (fromList || it.type === "track") return;
    dropPreloaded();
    if (it.type === "book") setList(startSingle(state.upNext, null), "list");
    else void putRefs(startSingle(toRefs(state.upNext), { itemType: "episode", itemId: it.id, added: false })).catch(() => undefined);
  }

  async function playRef(ref: PlayRef, startAt?: number) {
    try {
      play(await platform.loadPlayable(ref), startAt);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Couldn't load that." });
    }
  }

  /** Puts an item back paused, as it was when the app or page closed. */
  function putBack(it: Playable) {
    set({ item: it, speed: it.speed });
    load(it, it.startAt, false);
    platform.itemShown?.(it);
  }

  /** Brings the loaded item's details up to date (fresher from the server), moving to `at` if given. */
  function updateItem(it: Playable, at?: number) {
    const faster = it.speed !== state.speed;
    set({ item: it, speed: it.speed });
    if (at !== undefined && Math.abs(at - position) > 1) load(it, at, false);
    else if (faster) media.setRate(it.speed);
  }

  // ---------- Bookmarks: the hold after a jump ----------

  /** A jump to a bookmark not yet taken as your place: until it ends, saves leave the real place alone. */
  let hold: JumpHold | null = null;

  /** Sets the hold for a jump to `sec`, away from `returnTo`. A jump from a held spot keeps the real place. */
  function startHold(type: PlayType, id: string, returnTo: number, sec: number) {
    if (hold) hold = { ...hold, from: sec, heard: 0 };
    else if (offersGoBack(returnTo, sec)) {
      hold = { type, id, returnTo, from: sec, heard: 0 };
      set({ goBackTo: returnTo });
    }
  }

  function endHold() {
    hold = null;
    if (state.goBackTo !== null) set({ goBackTo: null });
  }

  /** Plays a bookmark. Your real place stays saved until it's clear you've moved on, and Go back returns to it. */
  /** Resolves true once it plays, false if the item couldn't be loaded (`error` then says why). */
  async function jumpTo(ref: PlayRef, sec: number): Promise<boolean> {
    const cur = state.item;
    if (cur && isCurrent(state, ref.itemType, ref.itemId)) {
      // First, so a seek while paused doesn't save the new spot.
      startHold(cur.type, cur.id, position, sec);
      seek(sec);
      media.play();
      return true;
    }
    try {
      const it = await platform.loadPlayable(ref);
      play(it, sec);
      // Leaving a held item ended its hold, so this one starts fresh against its own saved place.
      startHold(it.type, it.id, it.startAt, sec);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Couldn't load that." });
      return false;
    }
  }

  /** Puts back what was playing when the page or app closed, paused, at the place saved with it. */
  function restore(saved: SavedPlace, it: Playable) {
    putBack(it.type !== "track" && saved.at !== undefined ? { ...it, startAt: saved.at } : it);
  }

  /** Back to the real place. */
  function goBack() {
    const to = hold?.returnTo;
    if (to === undefined) return;
    endHold();
    seek(to);
  }

  /** The Go back card's X, and how a hold runs out: this spot is your place now. */
  function stayHere() {
    if (!hold) return;
    endHold();
    void save();
  }

  function toggle() {
    const it = state.item;
    if (!it) return;
    platform.haptic?.();
    // After an error the player is stuck; play loads it again from where it was.
    if (state.error) return load(it, position, true);
    if (media.playing) return media.pause();
    // Pressing play at the very end starts again rather than doing nothing.
    if (it.durationSec && position >= it.durationSec - 1) seek(0);
    media.play();
  }

  const pause = () => media.pause();

  function seek(sec: number) {
    const it = state.item;
    if (!it) return;
    const dur = it.durationSec || media.duration || 0;
    const t = Math.min(Math.max(0, sec), Math.max(0, dur - 0.5));
    const idx = fileAt(it, t);
    if (idx === fileIndex && fileReady) {
      media.seekTo(t - (it.files[idx]?.startSec ?? 0));
      lastTickAt = 0;
      setPosition(t);
    } else {
      load(it, t, media.playing || (!fileReady && loadAutoplay));
    }
    // "End of chapter" follows you to the chapter you land in.
    const chapter = it.chapters[chapterAt(it.chapters, t)];
    if (state.sleep.mode === "chapter" && it.chapters.length > 1 && chapter) set({ sleep: { mode: "chapter", endSec: chapter.endSec } });
    // While playing, progress saves every few seconds anyway; paused, nothing else would keep it.
    if (!state.playing) void save(false, false);
  }

  /** The skip buttons. Skipping forward into an ad counts as running into it; Undo comes back to where the skip landed. */
  function skipBy(delta: number) {
    platform.haptic?.();
    const from = position;
    seek(from + delta);
    if (delta > 0) skipAdCrossed(from, position, position);
  }

  /** Previous and next: the chapter, else the song or episode (see trackStep), else 30 s for a book. */
  function chapterStep(dir: -1 | 1) {
    const it = state.item;
    if (!it) return;
    if (it.type === "track") return trackStep(dir);
    if (it.chapters.length <= 1) return it.type === "book" ? skipBy(dir * 30) : trackStep(dir);
    platform.haptic?.();
    const i = chapterAt(it.chapters, position);
    if (dir === 1) {
      const next = it.chapters[i + 1];
      if (next) seek(next.startSec);
      return;
    }
    const cur = it.chapters[i];
    if (cur && position - cur.startSec > RESTART_AFTER_SEC) seek(cur.startSec);
    else seek(it.chapters[Math.max(0, i - 1)]?.startSec ?? 0);
  }

  function setSpeed(s: number) {
    const speed = clampSpeed(s);
    set({ speed });
    media.setRate(speed);
    const it = state.item;
    if (!it) return;
    set({ item: { ...it, speed } });
    // An episode's speed belongs to its show; a book's goes with its place.
    if (it.type === "episode" && it.podcastId) {
      void platform.api(apiPaths.podcast(it.podcastId), { method: "PATCH", body: { speed } }).catch(() => undefined);
    } else void save();
  }

  let sleepTimer: ReturnType<typeof setInterval> | null = null;
  function setSleep(s: SleepTimer) {
    set({ sleep: s });
    if (sleepTimer) clearInterval(sleepTimer);
    sleepTimer = null;
    if (s.mode !== "timer") return;
    sleepTimer = setInterval(() => {
      if (Date.now() < s.endsAt) return;
      media.pause();
      setSleep({ mode: "off" });
    }, 1000);
  }

  function setSkip(s: SkipSettings) {
    set({ skip: s });
    platform.setJson(SKIP_KEY, s);
    platform.skipChanged?.();
  }

  /** Marks the current item finished (it leaves the player) or back to the start; resolves once saved. */
  function markCurrent(finished: boolean): Promise<void> {
    endHold();
    if (finished) {
      const saved = save(true);
      clear();
      return saved;
    }
    seek(0);
    setPosition(0);
    return save(false, true);
  }

  /** Saves where it was and empties the player; resolves once that save is done (signing out waits for it). */
  function stop(): Promise<void> {
    const saved = state.playing ? save() : Promise.resolve(platform.saveListening(true));
    clear();
    return saved;
  }

  /** Empties the player without saving. */
  function clear() {
    set({ item: null, playing: false, loading: false, error: null });
    dropPreloaded();
    media.unload();
    platform.itemShown?.(null);
    platform.removeKey(NOW_PLAYING_KEY);
  }

  /** Startup: your skip settings, and shuffle and repeat as last known (the server's follow). */
  function init(prefs?: Pick<UserPrefs, "shuffle" | "repeat"> | null, upNext?: UpNextDto | null) {
    set({ skip: parseSkip(platform.getJson<SkipSettings>(SKIP_KEY)), ...(upNext ? { upNext } : {}) });
    if (prefs) setMusicPrefs({ shuffle: prefs.shuffle ?? false, repeat: prefs.repeat ?? "off" }, false);
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getPosition: () => position,
    subscribePosition(listener: () => void) {
      positionListeners.add(listener);
      return () => void positionListeners.delete(listener);
    },
    // From the audio
    loaded,
    time,
    loadingChanged,
    playingChanged,
    ended,
    failed,
    /** Saves where the item is now, as when the page is hidden or the app goes to the background. */
    save: () => save(),
    // Startup and restore
    init,
    setMusicPrefs,
    refreshUpNext,
    putBack,
    restore,
    updateItem,
    // Controls
    play,
    playRef,
    playMusic,
    playAt,
    trackStep,
    toggleShuffle,
    cycleRepeat,
    addToUpNext,
    removeFromUpNext,
    moveUpNext,
    clearUpNext,
    restoreUpNext,
    removeWaiting,
    jumpTo,
    goBack,
    stayHere,
    toggle,
    pause,
    seek,
    skipBy,
    chapterStep,
    setSpeed,
    setSleep,
    setSkip,
    markCurrent,
    stop,
    clear,
    /**
     * Reloads the current item where it is, playing if `autoplay`: casting started or ended (what
     * the spare player held is gone), or a stream failed and a downloaded copy can take over.
     */
    reload(autoplay: boolean) {
      dropPreloaded();
      if (state.item) load(state.item, position, autoplay);
    },
  };
}
