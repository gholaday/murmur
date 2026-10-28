import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "expo-router";
import { createVideoPlayer, type VideoPlayer, type VideoSource } from "expo-video";
import {
  apiPaths,
  defaultAudioTrack,
  errorText,
  type PlaybackPlan,
  playbackPlan,
  type PlaybackSupport,
  type StreamRequest,
  type StreamSessionDto,
  type VideoFileInfo,
  type VideoQuality,
  WATCHED_AT,
} from "@murmur/shared/client";
import { absolute, api, authHeaders } from "@/lib/api";
import { readVideoQuality, saveVideoQuality } from "@/lib/data";
import {
  invalidateWatch,
  markPictureUnplayable,
  pictureUnplayable,
  readVideoLanguage,
  readVideoSpeed,
  saveVideoLanguage,
  saveVideoSpeed,
  type WatchTarget,
} from "@/lib/watch";
import { getPlayerState, onPlayerChange, stop as stopAudio } from "./engine";

// The video being watched, kept outside the screens so it plays on in the mini player, like the
// audio engine. One expo-video player for the whole app; screens show it with a VideoView.
//
// A file plays as it is when this phone can (Media3 reads nearly every container and codec);
// otherwise the server streams it (HLS), copying what plays and converting what doesn't, the
// rules in @murmur/shared's playbackPlan. A stream starts where you are, so its own clock starts
// at 0 there: the place in the video is the stream's start plus the player's time.

export interface VideoItem {
  /** What the player screen opens, for the mini player to open it again. */
  target: WatchTarget;
  kind: "movie" | "episode";
  /** Where progress is kept: the movie's id (shared by its versions), or the episode's. */
  progressId: string;
  /** The file that plays: a movie version or an episode. */
  videoId: string;
  /** The movie, or the episode's own title. */
  title: string;
  /** Episodes: the show, and which episode ("S2 E4"). */
  showTitle: string | null;
  label: string | null;
  /** The poster's colour, tinting the player like the audio one. */
  color: string | null;
  file: VideoFileInfo;
  durationSec: number;
  /** Where to resume; 0 starts from the beginning. */
  startAt: number;
  /** Speed and the audio language are remembered per movie and per show. */
  speedKey: string;
  /** A converted-picture quality picked for this viewing; null means your setting. */
  quality: VideoQuality | null;
}

export interface VideoState {
  item: VideoItem | null;
  playing: boolean;
  /** Starting, or waiting for the next piece: the play button's ring turns. */
  loading: boolean;
  /** Plainly what went wrong, when it won't play. */
  error: string | null;
  speed: number;
  /** The file played to its end. */
  ended: boolean;
  /** How it's playing: the file itself, or a stream with the picture copied or converted. */
  plan: PlaybackPlan["kind"] | null;
  /** The audio track playing (the file's own index). */
  track: number;
  /** The quality a converted picture is made at. */
  quality: VideoQuality;
  /** A converted stream keeps running dry: the server converts slower than it plays. */
  slow: boolean;
}

const SAVE_EVERY_MS = 10_000;
/** Seeks within a stream stay this far from what's been made, so the player doesn't stall there. */
const EDGE_SEC = 2;
/** This many stalls on a converted stream and the player says the server can't keep up. */
const SLOW_AFTER_STALLS = 3;
/** A stream that fails is started again from where it was, this many times in a row at most. */
const MAX_RETRIES = 2;

/**
 * What this phone plays. Media3 reads every container we have and nearly every picture; the
 * picture is checked for real when the file loads (`forceTranscode` after that says no). Dolby
 * Digital needs a decoder many phones don't ship, and DTS and TrueHD none have, so their sound is
 * converted rather than left silent.
 */
const phoneSupport = (forceTranscode: boolean): PlaybackSupport => ({
  video: (codec) => !forceTranscode && !pictureUnplayable(codec),
  audio: (codec) => !["dts", "truehd", "mlpa", "ac-3", "ec-3"].includes(codec) && !codec.startsWith("pcm_"),
  container: () => null,
});

/** Whether the server will convert this file's picture for this phone, so a quality applies. */
export const convertsPicture = (file: VideoFileInfo) => playbackPlan(file, phoneSupport(false)).kind === "transcode";

let state: VideoState = {
  item: null,
  playing: false,
  loading: false,
  error: null,
  speed: 1,
  ended: false,
  plan: null,
  track: 0,
  quality: "full",
  slow: false,
};
let position = 0;
/** Nothing is saved until you've watched or moved, so opening and closing changes nothing. */
let touched = false;
/** The current source has loaded and gone to where it starts. */
let loaded = false;
/** Where in the video the stream's clock starts; 0 for the file itself. */
let offset = 0;
/** Where the source loading now should go once it's open, in the video's time. */
let pendingAt = 0;
let session: string | null = null;
/** Bumped on every new source, so answers for an older one are ignored. */
let generation = 0;
let forceTranscode = false;
let stalls = 0;
let retries = 0;
let saveTimer: ReturnType<typeof setInterval> | null = null;
const stateListeners = new Set<() => void>();
const positionListeners = new Set<() => void>();

function set(change: Partial<VideoState>) {
  state = { ...state, ...change };
  stateListeners.forEach((l) => l());
}

function setPosition(p: number) {
  position = p;
  if (appActive) positionListeners.forEach((l) => l());
}

let appActive = AppState.currentState !== "background";
AppState.addEventListener("change", (s) => {
  appActive = s !== "background";
  if (appActive) positionListeners.forEach((l) => l());
});

let player: VideoPlayer | null = null;

/** The one player, made the first time a video opens (the skips are set when it's made). */
export function videoPlayer(): VideoPlayer {
  if (player) return player;
  const { skip } = getPlayerState();
  const p = createVideoPlayer(null, { seekBackwardIncrement: skip.back, seekForwardIncrement: skip.forward });
  p.timeUpdateEventInterval = 0.5;
  p.staysActiveInBackground = true;
  p.showNowPlayingNotification = true;
  p.addListener("timeUpdate", ({ currentTime }) => {
    // Before the source opens (and goes to its start) the time reads 0; it isn't your place.
    if (!loaded) return;
    setPosition(offset + currentTime);
    if (state.item && p.playing && Math.abs(position - state.item.startAt) > 3) touched = true;
  });
  p.addListener("sourceLoad", ({ availableVideoTracks }) => {
    const it = state.item;
    if (!it) return;
    // The picture this phone can't decode (10-bit HEVC on an older one, say) would sit loading
    // forever: have the server convert it instead, from the same spot.
    if (availableVideoTracks.length && availableVideoTracks.every((v) => !v.isSupported) && !forceTranscode) {
      forceTranscode = true;
      markPictureUnplayable(it.file.videoCodec);
      void start(pendingAt);
      return;
    }
    p.playbackRate = state.speed;
    // The file itself goes to its place; a stream already starts there (a live playlist can open near its edge, hence 0).
    p.currentTime = Math.max(0, pendingAt - offset);
    setPosition(pendingAt);
    loaded = true;
    retries = 0;
    p.play();
  });
  p.addListener("playingChange", ({ isPlaying }) => {
    set({ playing: isPlaying, ...(isPlaying ? { ended: false } : {}) });
    if (saveTimer) clearInterval(saveTimer);
    saveTimer = isPlaying ? setInterval(save, SAVE_EVERY_MS) : null;
    if (!isPlaying) save();
  });
  p.addListener("statusChange", ({ status, error }) => {
    if (!state.item) return;
    if (status === "error") onError(error?.message);
    else if (status === "readyToPlay") set({ loading: false });
    else if (status === "loading") {
      set({ loading: true });
      // A converted stream running dry after it started means the server can't keep up.
      if (loaded && state.plan === "transcode" && position > offset + 1 && ++stalls >= SLOW_AFTER_STALLS) set({ slow: true });
    }
  });
  p.addListener("playToEnd", () => {
    const it = state.item;
    // A file whose picture fails to decode can report its end at the start; that's an error, not
    // the end, and it mustn't move on to the next episode.
    if (!it || !loaded || position < it.durationSec * WATCHED_AT) return;
    setPosition(it.durationSec);
    touched = true;
    set({ playing: false, ended: true });
    save();
  });
  player = p;
  return p;
}

function onError(message: string | undefined) {
  const at = loaded ? position : pendingAt;
  // A file that won't open as it is gets streamed instead, and a stream that broke (a session
  // that ended while paused a long time, a dropped connection) starts again from here.
  if (state.plan === "direct" || retries < MAX_RETRIES) {
    retries++;
    // A picture the phone can't decode is remembered, so files like it convert from the start.
    if (state.plan === "direct" && /decod|codec|format|unsupported/i.test(message ?? "")) {
      forceTranscode = true;
      markPictureUnplayable(state.item?.file.videoCodec ?? null);
    }
    void start(at, state.plan === "direct");
    return;
  }
  set({ loading: false, playing: false, error: playError(message) });
}

function playError(message: string | undefined): string {
  if (message && /network|connect|timeout|http/i.test(message)) return "The video stopped loading. Check your connection and try again.";
  return "This video won't play here.";
}

/** Tells the server a stream is done with, so ffmpeg stops; nothing to do if that fails. */
function endSession() {
  if (session) void api(apiPaths.streamSession(session), { method: "DELETE" }).catch(() => undefined);
  session = null;
}

/** Your setting for converted pictures, read when a converted stream first needs it. */
const qualityFor = (it: VideoItem): Promise<VideoQuality> => (it.quality ? Promise.resolve(it.quality) : readVideoQuality());

/**
 * Opens the current video at `at` seconds: the file itself, or a new stream from there.
 * `forceRemux` is for a file that was tried as it is and wouldn't open.
 */
async function start(at: number, forceRemux = false) {
  const it = state.item;
  const p = player;
  if (!it || !p) return;
  const gen = ++generation;
  endSession();
  loaded = false;
  pendingAt = at;
  stalls = 0;
  const plan = playbackPlan(it.file, phoneSupport(forceTranscode), { track: state.track, forceRemux });
  set({ plan: plan.kind, loading: true, error: null, slow: false });
  const metadata = {
    title: it.kind === "episode" ? (it.showTitle ?? it.title) : it.title,
    artist: it.kind === "episode" ? `${it.label}, ${it.title}` : undefined,
  };
  let source: VideoSource;
  if (plan.kind === "direct") {
    offset = 0;
    source = { uri: absolute(apiPaths.videoUrl(it.videoId)), headers: authHeaders(), metadata };
  } else {
    let s: StreamSessionDto;
    try {
      const quality = plan.kind === "transcode" ? await qualityFor(it) : undefined;
      if (quality) set({ quality });
      const body: StreamRequest = { track: plan.track, audio: plan.audio, video: plan.kind === "transcode" ? "h264" : "copy", quality, start: at };
      s = await api<StreamSessionDto>(apiPaths.videoStream(it.videoId), { method: "POST", body });
    } catch (err) {
      if (gen === generation) set({ loading: false, error: errorText(err) });
      return;
    }
    // Opened something else meanwhile: this stream isn't wanted.
    if (gen !== generation || state.item !== it) {
      void api(apiPaths.streamSession(s.sessionId), { method: "DELETE" }).catch(() => undefined);
      return;
    }
    session = s.sessionId;
    offset = s.start;
    pendingAt = Math.max(at, s.start);
    source = { uri: absolute(s.playlistUrl), headers: authHeaders(), contentType: "hls", metadata };
  }
  if (gen === generation) await p.replaceAsync(source);
}

/** Saves your place, the same as books: every few seconds while playing, and on pause. */
function save() {
  const it = state.item;
  if (!it || !touched || !loaded) return;
  // A stream only knows the part made so far; the file's length comes from the server.
  const dur = it.durationSec;
  if (!dur) return;
  const at = state.ended ? dur : position;
  const finished = at >= dur * WATCHED_AT;
  api("/api/progress", {
    method: "PUT",
    body: {
      items: [{ itemType: "video", itemId: it.progressId, positionSec: finished ? dur : at, durationSec: dur, finished, updatedAt: Date.now() }],
    },
  })
    .then(invalidateWatch)
    .catch(() => undefined);
}

/** The remembered language's track, when the file has one and it isn't the default. */
function rememberedTrack(it: VideoItem): number {
  const main = defaultAudioTrack(it.file);
  const language = readVideoLanguage(it.speedKey);
  const mainLanguage = it.file.audioTracks.find((t) => t.index === main)?.language;
  if (!language || mainLanguage === language) return main;
  return it.file.audioTracks.find((t) => t.language === language)?.index ?? main;
}

/**
 * Starts a video, stopping whatever audio was on (its place is saved). Opening the one already
 * on (from the mini player) carries on where it is.
 */
export function openVideo(item: VideoItem) {
  const cur = state.item;
  if (cur && cur.progressId === item.progressId && cur.videoId === item.videoId) return;
  if (cur) save();
  stopAudio();
  videoPlayer();
  touched = false;
  forceTranscode = false;
  retries = 0;
  setPosition(item.startAt);
  set({
    item,
    playing: false,
    ended: false,
    speed: readVideoSpeed(item.speedKey),
    track: rememberedTrack(item),
    quality: item.quality ?? "full",
  });
  // A finished movie, or one with only the credits left, starts over.
  void start(item.startAt > 0 && item.startAt < item.durationSec * WATCHED_AT ? item.startAt : 0);
}

/** Ends the video: from the mini player's close button, or when it can't play. */
export function closeVideo() {
  if (!state.item) return;
  save();
  generation++;
  loaded = false;
  if (saveTimer) clearInterval(saveTimer);
  saveTimer = null;
  endSession();
  player?.pause();
  void player?.replaceAsync(null);
  set({ item: null, playing: false, loading: false, error: null, ended: false, plan: null, slow: false });
}

/** Marks it watched and stops; the place saved on the way out would undo that, so it isn't. */
export function finishVideo() {
  touched = false;
  closeVideo();
}

// Playing audio later ends the video the same way.
onPlayerChange((s) => {
  if (s.item && state.item) closeVideo();
});

export function toggleVideo() {
  const p = player;
  if (!p || !state.item) return;
  if (p.playing) p.pause();
  else if (state.ended) seekVideo(0);
  else p.play();
}

/**
 * Moves to a point in the video. A stream only has what the server has made so far from where it
 * started; anywhere else needs a new stream from there.
 */
export function seekVideo(sec: number) {
  const p = player;
  const it = state.item;
  if (!p || !it) return;
  touched = true;
  const to = Math.max(0, Math.min(it.durationSec || p.duration || 0, sec));
  setPosition(to);
  if (state.ended) set({ ended: false });
  const rel = to - offset;
  if (state.plan === "direct" || (loaded && rel >= 0 && rel <= p.duration - EDGE_SEC)) {
    p.currentTime = rel;
    p.play();
  } else void start(to);
}

export const skipVideo = (delta: number) => seekVideo(position + delta);

export function setVideoSpeed(speed: number) {
  const it = state.item;
  if (!it) return;
  saveVideoSpeed(it.speedKey, speed);
  if (player) player.playbackRate = speed;
  set({ speed });
}

/** Another audio track: remembered by language for the movie or show, and picks up where you are. */
export function setVideoTrack(index: number) {
  const it = state.item;
  if (!it || index === state.track) return;
  saveVideoLanguage(it.speedKey, it.file.audioTracks.find((t) => t.index === index)?.language ?? null);
  set({ track: index });
  void start(position);
}

/**
 * Another quality for this video's converted picture: the stream starts again from here at it.
 * `remember` (the "too slow" note's Lower quality) saves it as your setting too.
 */
export function setVideoQuality(quality: VideoQuality, remember = false) {
  const it = state.item;
  if (!it) return;
  if (remember) saveVideoQuality(quality);
  if (quality === state.quality) return;
  set({ item: { ...it, quality }, quality });
  void start(position);
}

export const getVideoPosition = () => position;

export function useVideo(): VideoState {
  return useSyncExternalStore(
    (l) => {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
    () => state,
  );
}

/** Position and length in seconds; only components that show time should subscribe. */
export function useVideoTime(): { position: number; total: number } {
  const p = useSyncExternalStore(
    (l) => {
      positionListeners.add(l);
      return () => positionListeners.delete(l);
    },
    () => position,
  );
  return { position: p, total: state.item?.durationSec || 0 };
}

// ---------- Where the picture shows ----------

// Android shows one player in one view at a time, and screens under the top one stay mounted
// (the tabs' mini player under a movie page, say), so only the screen on top shows the picture.
export const useVideoHost = useIsFocused;
