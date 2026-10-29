import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "expo-router";
import { createVideoPlayer, type VideoPlayer, type VideoSource } from "expo-video";
import {
  apiPaths,
  CAST_SUPPORT,
  errorText,
  type PlaybackPlan,
  playbackPlan,
  type PlaybackSupport,
  resumeStart,
  type StreamRequest,
  type StreamSessionDto,
  trackForLanguage,
  VIDEO_PLAYER,
  type VideoFileInfo,
  type VideoQuality,
  WATCHED_AT,
} from "@murmur/shared/client";
import { absolute, api, authHeaders } from "@/lib/api";
import { readVideoQuality, saveVideoQuality } from "@/lib/data";
import { localVideo, type VideoDownloadSource } from "@/lib/downloads";
import {
  markPictureUnplayable,
  pictureUnplayable,
  readVideoLanguage,
  saveVideoLanguage,
  type WatchTarget,
} from "@/lib/watch";
import { CastPlayer, onCastDevice } from "./cast";
import { artworkFile, countWatching, getPlayerState, onPlayerChange, queueProgress, stop as stopAudio, unsentProgress } from "./engine";

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
  /** The media notification's second line and picture (a server path): a movie's year and backdrop, an episode's show and still. */
  sub: string;
  art: string | null;
  /** A wide picture (a server path) for the TV and the player while casting: a movie's backdrop (else poster), an episode's still. */
  castArt: string | null;
  file: VideoFileInfo;
  durationSec: number;
  /** Where to resume; 0 starts from the beginning. */
  startAt: number;
  /** The audio language is remembered per movie and per show. */
  memoryKey: string;
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

/** A paused stream's playlist is asked for this often, so the server keeps its session. */
const KEEP_ALIVE_MS = 120_000;
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
/** The open stream's playlist, asked for while paused to keep its session. */
let playlist: string | null = null;
let aliveTimer: ReturnType<typeof setInterval> | null = null;
/** Bumped on every new source, so answers for an older one are ignored. */
let generation = 0;
let forceTranscode = false;
let stalls = 0;
let retries = 0;
let saveTimer: ReturnType<typeof setInterval> | null = null;
/** When the last time update came while playing, for watch time; 0 when it wasn't. */
let watchedAt = 0;
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
  // While casting the Chromecast reports instead; this player is paused and emptied.
  p.addListener("timeUpdate", ({ currentTime }) => !casting && timeUpdate(currentTime, p.playing));
  p.addListener("sourceLoad", ({ availableVideoTracks }) => {
    const it = state.item;
    if (!it || casting) return;
    // The picture this phone can't decode (10-bit HEVC on an older one, say) would sit loading
    // forever: have the server convert it instead, from the same spot.
    if (availableVideoTracks.length && availableVideoTracks.every((v) => !v.isSupported) && !forceTranscode) {
      forceTranscode = true;
      markPictureUnplayable(it.file.videoCodec);
      void start(pendingAt);
      return;
    }
    // The file itself goes to its place; a stream already starts there (a live playlist can open near its edge, hence 0).
    p.currentTime = Math.max(0, pendingAt - offset);
    setPosition(pendingAt);
    loaded = true;
    retries = 0;
    if (playOnLoad) p.play();
    playOnLoad = true;
  });
  p.addListener("playingChange", ({ isPlaying }) => !casting && playingChanged(isPlaying));
  p.addListener("statusChange", ({ status, error }) => {
    if (!state.item || casting) return;
    if (status === "error") onError(error?.message);
    else if (status === "readyToPlay") set({ loading: false });
    else if (status === "loading") buffering();
  });
  p.addListener("playToEnd", () => !casting && playedToEnd());
  player = p;
  return p;
}

// ---------- What the phone's player and the Chromecast both report ----------

function timeUpdate(currentTime: number, playing: boolean) {
  // Before the source opens (and goes to its start) the time reads 0; it isn't your place.
  if (!loaded) return;
  const before = position;
  setPosition(offset + currentTime);
  const it = state.item;
  if (it && playing && Math.abs(position - it.startAt) > VIDEO_PLAYER.touchedAfterSec) touched = true;
  // Watch time for the stats, counted like listening: the smaller of the clock and the picture's moves.
  const now = Date.now();
  if (it && playing && watchedAt) countWatching(it.progressId, (now - watchedAt) / 1000, position - before, 1);
  watchedAt = playing ? now : 0;
}

function playingChanged(isPlaying: boolean) {
  set({ playing: isPlaying, ...(isPlaying ? { ended: false } : {}) });
  if (saveTimer) clearInterval(saveTimer);
  saveTimer = isPlaying ? setInterval(() => save(), VIDEO_PLAYER.saveEveryMs) : null;
  if (!isPlaying) save(true);
  keepAlive(!isPlaying);
}

function buffering() {
  set({ loading: true });
  // A converted stream running dry after it started means the server can't keep up.
  if (loaded && state.plan === "transcode" && position > offset + 1 && ++stalls >= VIDEO_PLAYER.slowAfterStalls) set({ slow: true });
}

function playedToEnd() {
  const it = state.item;
  // A file whose picture fails to decode can report its end at the start; that's an error, not
  // the end, and it mustn't move on to the next episode.
  if (!it || !loaded || position < it.durationSec * WATCHED_AT) return;
  setPosition(it.durationSec);
  touched = true;
  set({ playing: false, ended: true });
  save(true);
}

// ---------- Casting ----------

/** While casting, the Chromecast plays instead of the phone's player. */
let casting = false;
/** Whether the phone's player plays once its source opens; not when a cast hands the video back, paused. */
let playOnLoad = true;

const castVideo = new CastPlayer({
  loaded: () => {
    loaded = true;
    retries = 0;
    setPosition(offset + castVideo.position);
    set({ loading: false });
    playingChanged(castVideo.playing);
  },
  time: () => timeUpdate(castVideo.position, castVideo.playing),
  playing: playingChanged,
  buffering: (on) => (on ? buffering() : set({ loading: false })),
  ended: playedToEnd,
});

// A connected Chromecast takes the video over from where it is, playing if it was playing, and
// Google's notification replaces this one. When casting ends it comes back here paused, where the TV left it.
onCastDevice((device) => {
  const p = player;
  if (device && !casting) {
    const wasPlaying = state.playing;
    casting = true;
    if (p) {
      p.showNowPlayingNotification = false;
      p.pause();
      void p.replaceAsync(null);
    }
    if (state.item) void start(position, false, wasPlaying);
  } else if (!device && casting) {
    casting = false;
    castVideo.release();
    if (p) p.showNowPlayingNotification = true;
    if (state.playing) playingChanged(false);
    if (state.item) {
      playOnLoad = false;
      void start(position);
    }
  }
});

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
  playlist = null;
  keepAlive(false);
}

/**
 * While a stream is paused, asks for its playlist now and then: the server ends a session nobody
 * asks for, and resuming after a long pause would then have to start a new one.
 */
function keepAlive(on: boolean) {
  if (aliveTimer) clearInterval(aliveTimer);
  aliveTimer = null;
  if (!on || !playlist || state.playing) return;
  const url = absolute(playlist);
  aliveTimer = setInterval(() => void fetch(url, { headers: authHeaders() }).catch(() => undefined), KEEP_ALIVE_MS);
}

/** Your setting for converted pictures, read when a converted stream first needs it. */
const qualityFor = (it: VideoItem): Promise<VideoQuality> => (it.quality ? Promise.resolve(it.quality) : readVideoQuality());

/**
 * Opens the current video at `at` seconds: the file itself, or a new stream from there.
 * `forceRemux` is for a file that was tried as it is and wouldn't open. While casting it goes to
 * the Chromecast instead (playing if `autoplay`), as a file or stream the TV can play.
 */
async function start(at: number, forceRemux = false, autoplay = true) {
  const it = state.item;
  const p = player;
  if (!it || !p) return;
  const gen = ++generation;
  const toTv = casting;
  endSession();
  loaded = false;
  watchedAt = 0;
  pendingAt = at;
  stalls = 0;
  // The media notification shows a missing or empty second line as "null".
  const metadata = toTv ? undefined : { title: it.title, artist: it.sub, artwork: await artworkFile(it.art) };
  if (gen !== generation) return;
  // A download plays from the phone, even online, while it holds the audio track you're on.
  // One that wouldn't open (forceRemux) is streamed instead. The TV streams from the server.
  const saved = forceRemux || toTv ? null : localVideo(it.videoId);
  if (saved && saved.track === state.track) {
    set({ plan: "direct", loading: true, error: null, slow: false });
    offset = 0;
    if (gen === generation) await p.replaceAsync({ uri: saved.uri, metadata });
    return;
  }
  const plan = playbackPlan(it.file, toTv ? CAST_SUPPORT : phoneSupport(forceTranscode), { track: state.track, forceRemux });
  set({ plan: plan.kind, loading: true, error: null, slow: false });
  const toCast = (path: string) =>
    castVideo.load(path, { title: it.title, subtitle: it.sub, image: it.castArt }, Math.max(0, pendingAt - offset), autoplay);
  let source: VideoSource;
  if (plan.kind === "direct") {
    offset = 0;
    if (toTv) return toCast(apiPaths.videoUrl(it.videoId));
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
    playlist = s.playlistUrl;
    offset = s.start;
    pendingAt = Math.max(at, s.start);
    if (toTv) return toCast(s.playlistUrl);
    source = { uri: absolute(s.playlistUrl), headers: authHeaders(), contentType: "hls", metadata };
  }
  if (gen === generation) await p.replaceAsync(source);
}

/**
 * Saves your place, the same as books: every few seconds while playing, and on pause. Only
 * `refresh` (pause, the end, closing) reloads the Watch lists, once the server has it.
 */
function save(refresh = false) {
  const it = state.item;
  if (!it || !touched || !loaded) return;
  // A stream only knows the part made so far; the file's length comes from the server.
  const dur = it.durationSec;
  if (!dur) return;
  const at = state.ended ? dur : position;
  const finished = at >= dur * WATCHED_AT;
  // Through the audio engine's outbox, so a download watched offline syncs later.
  queueProgress(
    { itemType: "video", itemId: it.progressId, positionSec: finished ? dur : at, durationSec: dur, finished, updatedAt: Date.now() },
    refresh || finished,
  );
}

/** The audio track for the language remembered for the movie or show (`key`), else the default. */
const trackFor = (file: VideoFileInfo, key: string) => trackForLanguage(file, readVideoLanguage(key));

const rememberedTrack = (it: VideoItem) => trackFor(it.file, it.memoryKey);

/**
 * Where a movie version or episode (`videoId`) downloads from: the file as it is when this phone
 * plays it, else an MP4 the server makes with your audio track and, for a converted picture, the
 * page's quality or your setting. `key` is the movie or show, for the remembered audio language.
 */
export async function videoDownloadSource(file: VideoFileInfo, videoId: string, key: string, quality: VideoQuality | null): Promise<VideoDownloadSource> {
  const track = trackFor(file, key);
  const plan = playbackPlan(file, phoneSupport(false), { track });
  if (plan.kind === "direct") return { made: false, url: apiPaths.videoUrl(videoId), track };
  const video = plan.kind === "transcode" ? "h264" : "copy";
  return {
    made: true,
    videoId,
    request: { track: plan.track, audio: plan.audio, video, quality: quality ?? (await readVideoQuality()) },
    track: plan.track,
  };
}

/**
 * Starts a video, stopping whatever audio was on (its place is saved). Opening the one already
 * on (from the mini player) carries on where it is.
 */
export function openVideo(opened: VideoItem) {
  const cur = state.item;
  // The same video carries on, unless it was asked for at another quality.
  if (cur && cur.progressId === opened.progressId && cur.videoId === opened.videoId && (opened.quality == null || opened.quality === state.quality)) return;
  if (cur) save(true);
  // Watched on this phone since the server last heard (offline, say): that place is the newest.
  const unsent = unsentProgress("video", opened.progressId);
  const item = unsent ? { ...opened, startAt: unsent.finished ? 0 : unsent.positionSec } : opened;
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
    track: rememberedTrack(item),
    quality: item.quality ?? "full",
  });
  void start(resumeStart(item.startAt, item.durationSec));
}

/** Ends the video: from the mini player's close button, or when it can't play. */
export function closeVideo() {
  if (!state.item) return;
  save(true);
  generation++;
  loaded = false;
  if (saveTimer) clearInterval(saveTimer);
  saveTimer = null;
  endSession();
  player?.pause();
  void player?.replaceAsync(null);
  // Closing while casting stops the TV too.
  castVideo.stop();
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
  const p = casting ? castVideo : player;
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
  if (casting) {
    // The TV's player lets go once it reaches the end, so going back loads it again.
    const made = castVideo.duration - VIDEO_PLAYER.edgeSec;
    if (castVideo.live && (state.plan === "direct" || (rel >= 0 && rel <= made))) {
      castVideo.seek(rel);
      castVideo.play();
    } else void start(to);
    return;
  }
  if (state.plan === "direct" || (loaded && rel >= 0 && rel <= p.duration - VIDEO_PLAYER.edgeSec)) {
    p.currentTime = rel;
    p.play();
  } else void start(to);
}

export const skipVideo = (delta: number) => seekVideo(position + delta);

/** Another audio track: remembered by language for the movie or show, and picks up where you are. */
export function setVideoTrack(index: number) {
  const it = state.item;
  if (!it || index === state.track) return;
  saveVideoLanguage(it.memoryKey, it.file.audioTracks.find((t) => t.index === index)?.language ?? null);
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
