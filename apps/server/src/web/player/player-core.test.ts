import { expect, it } from "vitest";
import { createPlayerCore, DEFAULT_AD_PREFS, type Playable, type PlayerMedia, type ProgressItem, type TrackDto } from "@murmur/shared/client";

// The shared player's ordering and timing rules, with fake audio.

const track = (id: string, durationSec = 200): TrackDto => ({
  id,
  title: id,
  albumId: "al",
  album: "Album",
  artistId: "ar",
  artist: "Artist",
  discNo: null,
  trackNo: null,
  durationSec,
  mimeType: "audio/mpeg",
  coverHash: null,
  inMusic: true,
});

function setup() {
  const saved: ProgressItem[] = [];
  const loads: Array<{ id: string; at: number }> = [];
  let clock = 0;
  const media: PlayerMedia & { preloadedId: string | null; isPlaying: boolean } = {
    preloadedId: null,
    isPlaying: false,
    get playing() {
      return this.isPlaying;
    },
    duration: 0,
    load(it: Playable, _file: number, at: number, autoplay: boolean) {
      queueMicrotask(() => core.loaded(it.durationSec));
      loads.push({ id: it.id, at });
      this.isPlaying = autoplay;
    },
    play() {
      this.isPlaying = true;
    },
    pause() {
      this.isPlaying = false;
    },
    seekTo() {},
    setRate() {},
    preload(it: Playable) {
      this.preloadedId = it.id;
      return true;
    },
    swapToPreloaded() {
      loads.push({ id: `${this.preloadedId}(preloaded)`, at: 0 });
      return true;
    },
    dropPreloaded() {
      this.preloadedId = null;
    },
    unload() {},
  };
  const core = createPlayerCore({
    media,
    api: () => Promise.reject(new Error("offline")),
    refused: () => false,
    toast: () => undefined,
    toastError: () => undefined,
    getJson: () => null,
    setJson: () => undefined,
    removeKey: () => undefined,
    saveProgress: (entry) => void saved.push(entry),
    saveListening: () => undefined,
    addListening: () => undefined,
    countPlay: () => undefined,
    loadPlayable: () => Promise.reject(new Error("offline")),
    adPrefs: () => DEFAULT_AD_PREFS,
    now: () => clock,
  });
  /** Plays on for `sec` seconds from `from`, a tick each second. */
  const playOn = (from: number, sec: number) => {
    for (let t = from; t <= from + sec; t++) {
      clock += 1000;
      core.time(t, true);
    }
  };
  return { core, media, loads, saved, playOn };
}

const album = { kind: "album" as const, refId: "al", title: "Album", tracks: [track("a"), track("b"), track("c")] };

it("preloads the next song near the end and hands over to it without loading again", () => {
  const { core, media, loads, playOn } = setup();
  core.playMusic(album, 0);
  core.playingChanged(true);
  playOn(185, 6);
  expect(media.preloadedId).toBe("b");
  core.ended();
  expect(core.getState().item?.id).toBe("b");
  expect(loads.map((l) => l.id)).toEqual(["a", "b(preloaded)"]);
});

it("restarts the song on Previous once it's more than 3 seconds in", () => {
  const { core, playOn } = setup();
  core.playMusic(album, 1);
  core.playingChanged(true);
  playOn(0, 5);
  core.trackStep(-1);
  expect(core.getState().item?.id).toBe("b");
  core.trackStep(-1);
  expect(core.getState().item?.id).toBe("a");
});

it("saves a book's place on pause, but not a pause right at its end", () => {
  const { core, saved, playOn } = setup();
  const book: Playable = {
    type: "book",
    id: "bk",
    title: "Book",
    subtitle: null,
    coverPath: null,
    coverPathLarge: null,
    color: null,
    durationSec: 100,
    files: [{ path: "/f", startSec: 0, durationSec: 100 }],
    chapters: [],
    podcastId: null,
    album: null,
    startAt: 0,
    speed: 1,
  };
  core.play(book);
  core.playingChanged(true);
  playOn(10, 3);
  core.playingChanged(false);
  expect(saved.at(-1)).toMatchObject({ itemId: "bk", positionSec: 13, finished: false });
  core.playingChanged(true);
  playOn(99, 0);
  const before = saved.length;
  core.playingChanged(false);
  expect(saved.length).toBe(before);
});
