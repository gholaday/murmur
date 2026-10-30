"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  apiPaths,
  CAST_SUPPORT,
  clock,
  codecName,
  defaultAudioTrack,
  duration,
  episodeLabel,
  errorText,
  percentDone,
  type PlaybackPlan,
  playbackPlan,
  QUALITY_LABEL,
  resumeStart,
  type StreamRequest,
  type StreamSessionDto,
  timeLeft,
  trackDetails,
  trackForLanguage,
  trackName,
  VIDEO_PLAYER,
  type VideoQuality,
  type VideoAudioTrack,
  type VideoEpisode,
  type VideoFileInfo,
  videoLanguageKey,
  WATCHED_AT,
} from "@murmur/shared/client";
import { toast } from "sonner";
import { api } from "../api";
import { CAST_FAILED, CastMedia, MEDIA_EVENTS, type MediaEventName, stopCasting, useCast } from "../cast/cast";
import { CastButton } from "../cast/cast-button";
import {
  AudioTrackIcon,
  CastIcon,
  CloseIcon,
  DownIcon,
  FullscreenIcon,
  MoreIcon,
  NextChapterIcon,
  PauseIcon,
  PipIcon,
  PlayIcon,
  PrevChapterIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "../icons";
import { addWatching, sendListening, usePlayer } from "../player/engine";
import { usePullToClose } from "../player/full-player";
import { effectiveVolume, useVolume } from "../player/volume";
import { VolumeControl } from "../player/volume-control";
import { setFinished } from "../progress";
import { Sheet, SheetItem } from "../sheet";
import { playHref, Still } from "./cards";
import { QualitySheet } from "./quality-pick";
import { browserSupport, isSafari } from "./support";
import { useVideo } from "./video-session";

export interface PlayerItem {
  kind: "movie" | "episode";
  /** Where progress is kept: the movie's id, or the episode's. */
  progressId: string;
  /** The player's own page, which the mini player opens. */
  href: string;
  /** The file being played: the movie's chosen version, or the episode. */
  videoId: string;
  /** The movie, or the episode's own title. */
  title: string;
  /** Episodes: the show, and which episode ("S2 E4"). */
  showTitle: string | null;
  label: string | null;
  /** The poster's colour, tinting the player like the audio one. */
  color: string | null;
  /** A wide picture (the backdrop, or the episode's still) for the TV and the stage while casting. */
  art: string | null;
  /** The quality a converted picture is made at: picked for this one before playing, else your setting. */
  quality: VideoQuality;
  src: string;
  file: VideoFileInfo;
  durationSec: number;
  /** Where to resume; 0 starts from the beginning. */
  startAt: number;
  /** The movie or show page, for Back when the player was opened directly. */
  backHref: string;
  /** Episodes: the rest of the show, next one first. */
  next: VideoEpisode[];
  /** Your Play next episode setting: off, the next-episode card waits for a tap. */
  autoplayNext: boolean;
  /** The audio language is remembered per movie and per show. */
  memoryKey: string;
}

const {
  hideAfterMs: HIDE_AFTER_MS,
  saveEveryMs: SAVE_EVERY_MS,
  nextCardAtSec: NEXT_CARD_AT_SEC,
  countdown: COUNTDOWN,
  doubleTapMs: DOUBLE_TAP_MS,
  edgeSec: EDGE_SEC,
  slowAfterStalls: SLOW_AFTER_STALLS,
  touchedAfterSec: TOUCHED_AFTER_SEC,
} = VIDEO_PLAYER;
/** A phone on its side; a laptop window this short is rare enough to treat the same. */
const SIDEWAYS_PHONE = "(orientation: landscape) and (max-height: 600px)";

/** Tells the server a stream is done with, so ffmpeg stops; nothing to do if that fails. */
function endStream(sessionId: string) {
  void api(apiPaths.streamSession(sessionId), { method: "DELETE", keepalive: true }).catch(() => undefined);
}

/** The audio language picked for a movie or show, so its next file opens with the same one. */
function readLanguage(key: string): string | null {
  try {
    return localStorage.getItem(videoLanguageKey(key));
  } catch {
    return null;
  }
}

function saveLanguage(key: string, language: string | null) {
  try {
    if (language) localStorage.setItem(videoLanguageKey(key), language);
    else localStorage.removeItem(videoLanguageKey(key));
  } catch {
    // Not remembered in a private window.
  }
}

/** The remembered language's track; null for the file's default. */
function rememberedTrack(file: VideoFileInfo, key: string): number | null {
  const track = trackForLanguage(file, readLanguage(key));
  return track === defaultAudioTrack(file) ? null : track;
}

/**
 * The playhead and how far it's loaded, kept out of the player's state: only the scrubber, the
 * times and the mini bar re-render as it plays, not the sheets and episode rows.
 */
function createClock(time: number) {
  let snap = { time, buffered: 0 };
  const listeners = new Set<() => void>();
  return {
    get: () => snap,
    set(next: Partial<typeof snap>) {
      snap = { ...snap, ...next };
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
}
type Clock = ReturnType<typeof createClock>;
const useClock = (c: Clock) => useSyncExternalStore(c.subscribe, c.get, c.get);

function Scrubber({ store, total, onScrub, onRelease }: { store: Clock; total: number; onScrub: (to: number) => void; onRelease: (to: number) => void }) {
  const { time, buffered } = useClock(store);
  return (
    <input
      type="range"
      className="vp-scrub"
      aria-label="Position"
      min={0}
      max={total || 1}
      step={1}
      value={Math.min(time, total || 0)}
      style={{ "--played": `${percentDone(time, total)}%`, "--loaded": `${percentDone(buffered, total)}%` } as React.CSSProperties}
      onChange={(e) => onScrub(Number(e.target.value))}
      // A spot the stream hasn't made yet starts a new one once you let go.
      onPointerUp={(e) => onRelease(Number(e.currentTarget.value))}
      onKeyUp={(e) => onRelease(Number(e.currentTarget.value))}
    />
  );
}

/** Played and left, with the time left between them. */
function Times({ store, total }: { store: Clock; total: number }) {
  const { time } = useClock(store);
  return (
    <div className="vp-times">
      <span className="vp-time">{clock(time)}</span>
      <span className="vp-time vp-note">{timeLeft(total, time)}</span>
      <span className="vp-time">-{clock(Math.max(0, total - time))}</span>
    </div>
  );
}

function MiniSub({ store, total, label }: { store: Clock; total: number; label: string | null }) {
  const left = timeLeft(total, useClock(store).time);
  return <span className="mini-sub">{label ? `${label}, ${left}` : left}</span>;
}

function MiniBar({ store, total }: { store: Clock; total: number }) {
  return <div className="mini-bar" style={{ width: `${percentDone(useClock(store).time, total)}%` }} />;
}

/**
 * The video player: the file played as it is, in a <video>. Upright on a phone, the video sits at
 * the top with the details and next episodes under it; sideways, in full screen or on a wide
 * screen it fills the window, with controls that fade after a few seconds.
 */
export function VideoPlayer({ item, autoplay, mini }: { item: PlayerItem; autoplay: boolean; mini: boolean }) {
  const router = useRouter();
  const audio = usePlayer();
  const video = useVideo();
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  /** While casting the Chromecast plays instead of the <video>, through this stand-in for it. */
  const castDevice = useCast().device;
  const casting = !!castDevice;
  const castRef = useRef<CastMedia | null>(null);
  /** Where the video last was, for the save when the player closes. */
  const lastSeen = useRef<{ at: number; duration: number } | null>(null);
  const castingRef = useRef(casting);
  /** What plays: the <video>, or the Chromecast. */
  const media = useCallback(() => (castingRef.current ? castRef.current : videoRef.current), []);
  /** Null until the support check ran (it needs the browser). */
  const [plan, setPlan] = useState<PlaybackPlan | null>(null);
  // The player only renders in the browser (the shell opens it), so storage can be read up front.
  /** The audio track picked; null plays the default one. */
  const [track, setTrack] = useState<number | null>(() => rememberedTrack(item.file, item.memoryKey));
  /** The file was tried as it is and wouldn't open. */
  const [forceRemux, setForceRemux] = useState(false);
  /** The file played as it is; null while streaming or before it's known. */
  const [src, setSrc] = useState<string | null>(null);
  /** The stream playing, when the file isn't played as it is. */
  const [stream, setStream] = useState<StreamSessionDto | null>(null);
  /** A converted stream keeps running dry: the server can't keep up. */
  const [slow, setSlow] = useState(false);
  /** The quality whose "converting slower" card was waved away; another quality brings it back. */
  const [slowShut, setSlowShut] = useState<VideoQuality | null>(null);
  const stalls = useRef(0);
  /** Waiting for the stream to start, or for the next piece. */
  const [buffering, setBuffering] = useState(false);
  const qualityRef = useRef<VideoQuality>(item.quality);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [qualityShown, setQualityShown] = useState<VideoQuality>(item.quality);
  const volume = useVolume();
  /** Bumped to start a new stream session, at `resumeAt` (a seek past what's been made). */
  const [restartKey, setRestartKey] = useState(0);
  const [audioOpen, setAudioOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  /** Where the next file or stream starts, when switching tracks, seeking far or falling back to a stream. */
  const resumeAt = useRef<number | null>(null);
  /** A stream's clock starts at 0 where it starts in the video; this is that point. 0 for the file as it is. */
  const offsetRef = useRef(0);
  const streamingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  /** Whether a (re)loaded video should run: after Play was pressed, and across a track, quality or seek restart while playing. */
  const wantPlay = useRef(autoplay);
  const [times] = useState(() => createClock(item.startAt));
  const [total, setTotal] = useState(item.durationSec);
  const [controls, setControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const nextDismissed = useRef(false);
  const touched = useRef(false);
  /** The last time update while playing, for watch time; null after a pause or seek, so the next one counts nothing. */
  const lastTick = useRef<{ at: number; pos: number } | null>(null);
  const lastTap = useRef({ at: 0, x: 0 });
  const next = item.next[0] ?? null;

  // A video takes over from whatever audio was on: it saves its place and leaves the mini player.
  // It also takes the browser's media controls (below), and hands them back when it closes.
  const stopAudio = useRef(audio.stop);
  const claimAudioControls = useRef(audio.claimMediaSession);
  claimAudioControls.current = audio.claimMediaSession;
  useEffect(() => {
    stopAudio.current();
    return () => claimAudioControls.current();
  }, []);
  // And playing audio later ends the video. Only playing counts: after a reload the audio player
  // brings back its last item paused, which mustn't close the video.
  const audioAtStart = useRef(audio.item);
  const { close: closeVideo } = video;
  useEffect(() => {
    if (audio.item && audio.playing && audio.item !== audioAtStart.current) closeVideo();
  }, [audio.item, audio.playing, closeVideo]);

  // Casting starting or ending picks the video up from the same moment on the other side; when it
  // ends the video comes back paused. (Before the plan below, which starts again from resumeAt.)
  useEffect(() => {
    if (castingRef.current === casting) return;
    castingRef.current = casting;
    resumeAt.current = times.get().time;
    if (!casting) wantPlay.current = false;
  }, [casting, times]);

  // Plays the file as it is when the browser (or the Chromecast) can, or starts a stream from where you are.
  useEffect(() => {
    const p = playbackPlan(item.file, casting ? CAST_SUPPORT : browserSupport(item.file), { track, forceRemux });
    setPlan(p);
    setStream(null);
    setSlow(false);
    stalls.current = 0;
    streamingRef.current = p.kind !== "direct";
    if (p.kind === "direct") {
      offsetRef.current = 0;
      setSrc(item.src);
      return;
    }
    setSrc(null);
    setPlaying(false); // the <video> goes until the stream is there
    setBuffering(true);
    // A finished movie, or one with only the credits left, starts over.
    const first = resumeStart(item.startAt, item.durationSec);
    const from = resumeAt.current ?? first;
    resumeAt.current = null;
    let cancelled = false;
    let started: string | null = null;
    const quality = p.kind === "transcode" ? qualityRef.current : undefined;
    const body: StreamRequest = { track: p.track, audio: p.audio, video: p.kind === "transcode" ? "h264" : "copy", quality, start: from };
    api<StreamSessionDto>(apiPaths.videoStream(item.videoId), { method: "POST", body })
      .then((s) => {
        started = s.sessionId;
        if (cancelled) return endStream(s.sessionId);
        offsetRef.current = s.start;
        times.set({ time: s.start });
        setStream(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      });
    // A closed tab never unmounts, so the stream is ended from pagehide too.
    const onHide = () => {
      if (started) endStream(started);
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, [item.file, item.src, item.videoId, item.startAt, item.durationSec, track, forceRemux, restartKey, casting]);

  // A paused player stops fetching pieces, and the server ends a session nobody asks anything of
  // for five minutes; asking for the playlist now and then keeps it, so Play carries straight on.
  useEffect(() => {
    if (!stream || playing) return;
    const timer = setInterval(() => void fetch(stream.playlistUrl, { cache: "no-store" }).catch(() => undefined), 120_000);
    return () => clearInterval(timer);
  }, [stream, playing]);

  // Hands the stream to the <video>: Safari plays HLS itself, other browsers through hls.js.
  useEffect(() => {
    const v = videoRef.current;
    if (!stream || !v || casting) return;
    // Chrome claims it "maybe" plays HLS natively and then can't, so only Safari (or a browser without MediaSource) gets the playlist directly.
    if (isSafari() || !("MediaSource" in window)) {
      v.src = stream.playlistUrl;
      return;
    }
    let cancelled = false;
    let hls: { destroy: () => void } | null = null;
    void import("hls.js").then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        setError("This browser can't play this video.");
        return;
      }
      // A slow server answers 503 for a piece still being made; keep asking rather than giving up on the stream.
      const retry = { maxNumRetry: 8, retryDelayMs: 1000, maxRetryDelayMs: 8000 };
      const h = new Hls({
        startPosition: 0,
        maxBufferLength: 30,
        backBufferLength: 60,
        fragLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 30_000,
            maxLoadTimeMs: 60_000,
            timeoutRetry: retry,
            // A piece still being made is a 503 and is asked for again; a 404 is gone (cleared
            // behind the player), so the stream starts again there at once.
            errorRetry: { ...retry, shouldRetry: (_c, _n, _t, res, again) => again && res?.code !== 404 },
          },
        },
      });
      let recovered = false;
      /** Starts a new session at `at`, once: a few errors can arrive for the same moment. */
      let restarted = false;
      const restartAt = (at: number) => {
        if (restarted) return;
        restarted = true;
        resumeAt.current = at;
        setRestartKey((k) => k + 1);
      };
      h.on(Hls.Events.ERROR, (_event, data) => {
        // A piece cleared behind the player (a seek back past a few minutes): start again there,
        // or hls.js skips it and plays on from what it has.
        if (data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR && data.response?.code === 404 && data.frag) {
          restartAt(offsetRef.current + data.frag.start);
          return;
        }
        if (!data.fatal) return;
        console.warn("stream failed", data.type, data.details, data.error?.message, data.mimeType ?? "");
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // Usually a session that ended while paused a long time: start again from here.
          restartAt(offsetRef.current + v.currentTime);
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
          recovered = true;
          h.recoverMediaError();
        } else setError("This video won't play here.");
      });
      h.loadSource(stream.playlistUrl);
      h.attachMedia(v);
      hls = h;
    });
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [stream, casting]);

  // Closing the player while casting stops the TV too. (Before the effect below, whose cleanup lets go of it.)
  useEffect(
    () => () => {
      const cm = castRef.current;
      if (castingRef.current && cm?.src) {
        cm.removeAttribute("src");
        cm.load();
      }
      cm?.dispose();
    },
    [],
  );

  // While casting, the file or the stream goes to the Chromecast instead, from where you are.
  useEffect(() => {
    const path = src ?? stream?.playlistUrl;
    if (!casting || !path) return;
    let cm = castRef.current;
    if (!cm) {
      const made = new CastMedia(() => ({
        title: item.title,
        subtitle: item.showTitle && item.label ? `${item.showTitle}, ${item.label}` : null,
        image: item.art,
      }));
      for (const name of MEDIA_EVENTS) made.addEventListener(name, () => castEvents.current[name]());
      castRef.current = cm = made;
    }
    cm.src = path;
    // A stream already starts where it should; the file starts where you were.
    cm.startAt = stream ? 0 : (resumeAt.current ?? resumeStart(item.startAt, item.durationSec));
    if (!stream) resumeAt.current = null;
    cm.autoplay = wantPlay.current;
    cm.volume = effectiveVolume(volume);
    cm.load();
    return () => cm.release();
    // The volume is applied by its own effect; this runs for a new file, stream or cast.
  }, [casting, src, stream]);

  /** Where you are in the video: the player's clock, plus where a stream started. */
  const position = useCallback(() => offsetRef.current + (media()?.currentTime ?? 0), [media]);

  /**
   * Moves to a point in the video. A stream only has what ffmpeg has made so far from where it
   * started; anywhere else needs a new stream from there, which `restart` allows (the scrubber
   * waits for release so dragging doesn't start one per pixel).
   */
  const seekTo = useCallback(
    (t: number, restart = true) => {
      const v = media();
      if (!v) return;
      touched.current = true;
      const to = Math.max(0, Math.min(total || 0, t));
      if (!streamingRef.current) {
        v.currentTime = to;
        return;
      }
      const rel = to - offsetRef.current;
      const made = v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0;
      if (rel >= 0 && rel <= made - EDGE_SEC) v.currentTime = rel;
      else if (restart) {
        resumeAt.current = to;
        setRestartKey((k) => k + 1);
      }
    },
    [total, media],
  );

  /** Another quality for this video: the stream starts again from here at it. */
  const pickQuality = (q: VideoQuality) => {
    setQualityOpen(false);
    if (q === qualityRef.current) return;
    qualityRef.current = q;
    setQualityShown(q);
    resumeAt.current = position();
    setRestartKey((k) => k + 1);
  };

  /** The lighter conversion from the "too slow" note: saved to your settings too, so the next video starts there. */
  const lowerQuality = () => {
    void api(apiPaths.prefs, { method: "PUT", body: { videoQuality: "light" } }).catch(() => undefined);
    pickQuality("light");
  };

  // Floats above the tiles, or over the video in full screen, until waved away.
  const slowCard =
    slow && slowShut !== qualityShown ? (
      <div className="float-card vp-slow" role="status">
        <span>Converting slower than it plays</span>
        {qualityShown !== "light" ? (
          <button type="button" className="more-link" onClick={lowerQuality}>
            Lower quality
          </button>
        ) : null}
        <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setSlowShut(qualityShown)}>
          <CloseIcon size={20} />
        </button>
      </div>
    ) : null;

  // The volume slider is this device's, shared with the audio player.
  useEffect(() => {
    const v = media();
    if (!v) return;
    v.volume = effectiveVolume(volume);
    v.muted = volume.muted;
  }, [volume, src, stream, media]);

  /** Another audio track: remembered by language, and picks up where you are. */
  const pickTrack = (t: VideoAudioTrack) => {
    setAudioOpen(false);
    const current = track ?? defaultAudioTrack(item.file);
    if (t.index === current) return;
    resumeAt.current = position();
    saveLanguage(item.memoryKey, t.language);
    setTrack(t.index === defaultAudioTrack(item.file) ? null : t.index);
  };

  /** Saves your place; nothing is saved until you've actually watched or moved, so opening and closing changes nothing. */
  const save = useCallback(
    (keepalive = false) => {
      // On unmount the <video> is already gone, so the last place it reported stands in.
      const v = media();
      const seen = v ? { at: position(), duration: v.duration } : lastSeen.current;
      if (!seen || !touched.current) return;
      void sendListening(keepalive).catch(() => undefined);
      // A stream's <video> only knows the part made so far; the file's length comes from the server.
      const length = streamingRef.current ? item.durationSec : seen.duration;
      if (!Number.isFinite(length) || !length) return;
      const at = seen.at;
      const finished = at >= length * WATCHED_AT;
      void api("/api/progress", {
        method: "PUT",
        keepalive,
        body: {
          items: [
            {
              itemType: "video",
              itemId: item.progressId,
              positionSec: finished ? length : at,
              durationSec: length,
              finished,
              updatedAt: Date.now(),
            },
          ],
        },
      }).catch(() => undefined);
    },
    [item.progressId, item.durationSec, position, media],
  );

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => save(), SAVE_EVERY_MS);
    return () => clearInterval(timer);
  }, [playing, save]);

  useEffect(() => {
    const onHide = () => save(true);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      save(true);
    };
  }, [save]);

  // Controls fade while playing, and come back on any movement or tap, which also restarts the wait.
  const [pokedAt, setPokedAt] = useState(0);
  const poke = useCallback(() => {
    setControls(true);
    setPokedAt(Date.now());
  }, []);
  useEffect(() => {
    if (!controls || !playing) return;
    const timer = setTimeout(() => setControls(false), HIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [controls, playing, pokedAt]);

  const toggle = useCallback(() => {
    const v = media();
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, [media]);

  const skip = useCallback((delta: number) => seekTo(position() + delta), [seekTo, position]);

  const goNext = useCallback(() => {
    if (!next) return;
    save();
    router.replace(playHref("episode", next.id));
  }, [next, router, save]);

  const toggleFullscreen = useCallback(async () => {
    const el = rootRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
        // Phones turn sideways for full screen where the browser allows it.
        await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape").catch(() => undefined);
      }
    } catch {
      // Full screen refused (an iPhone outside the video itself); the layout already fills the window.
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // A phone turned sideways fills the screen the same as full screen.
  const [sideways, setSideways] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(SIDEWAYS_PHONE);
    const onChange = () => setSideways(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const pip = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch {
      // Not offered here.
    }
  };

  // Keyboard: space or K plays and pauses, arrows skip, F is full screen, Escape minimises. Only on the player's own page.
  const backRef = useRef(() => {});
  useEffect(() => {
    if (mini) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowLeft") skip(-audio.skip.back);
      else if (e.key === "ArrowRight") skip(audio.skip.forward);
      else if (e.key === "f") void toggleFullscreen();
      else if (e.key === "Escape" && !document.querySelector("dialog[open]") && !document.fullscreenElement) backRef.current();
      else return;
      poke();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mini, toggle, skip, toggleFullscreen, poke, audio.skip.back, audio.skip.forward]);

  // On a phone, pulling the top bar down minimises the player, as with the audio one.
  const pull = usePullToClose(() => backRef.current());

  // The next-episode card counts down while the video plays, then starts the next one (unless Play next episode is off).
  useEffect(() => {
    if (countdown === null || !playing || mini || !item.autoplayNext) return;
    if (countdown <= 0) {
      goNext();
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown, playing, mini, goNext, item.autoplayNext]);

  // Lock screen, media keys and the notification on phones.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({ title: item.title, artist: item.showTitle ?? "", album: item.label ?? "" });
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
      ["play", () => void media()?.play()],
      ["pause", () => media()?.pause()],
      ["seekbackward", () => skip(-audio.skip.back)],
      ["seekforward", () => skip(audio.skip.forward)],
      ["nexttrack", next ? goNext : null],
      ["previoustrack", null],
    ];
    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // Older browsers don't know every action.
      }
    }
  }, [item.title, item.showTitle, item.label, next, goNext, skip, audio.skip.back, audio.skip.forward]);

  const onStageTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mini) {
      router.push(item.href);
      return;
    }
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (countdown !== null) {
      // A tap anywhere but the card keeps watching this one.
      nextDismissed.current = true;
      setCountdown(null);
    }
    if (now - lastTap.current.at < DOUBLE_TAP_MS && Math.abs(x - lastTap.current.x) < 0.2 && (x < 0.35 || x > 0.65)) {
      skip(x < 0.5 ? -audio.skip.back : audio.skip.forward);
      poke();
      lastTap.current = { at: 0, x };
      return;
    }
    lastTap.current = { at: now, x };
    setControls((c) => !c);
  };

  const onTimeUpdate = () => {
    const v = media();
    if (!v) return;
    const at = position();
    lastSeen.current = { at, duration: v.duration };
    times.set({ time: at, buffered: v.buffered.length ? offsetRef.current + v.buffered.end(v.buffered.length - 1) : times.get().buffered });
    if (Math.abs(at - item.startAt) > TOUCHED_AFTER_SEC) touched.current = true;
    if (v.paused) lastTick.current = null;
    else {
      const prev = lastTick.current;
      const now = performance.now();
      if (prev) addWatching(item.progressId, (now - prev.at) / 1000, at - prev.pos, v.playbackRate || 1);
      lastTick.current = { at: now, pos: at };
    }
    const left = total - at;
    // The next episode only comes on by itself on the player's page, never from the mini player.
    if (!mini && next && countdown === null && !nextDismissed.current && left > 0 && left <= NEXT_CARD_AT_SEC) setCountdown(COUNTDOWN);
  };

  const onLoaded = () => {
    const v = media();
    if (!v) return;
    if (v instanceof CastMedia) {
      // The cast was sent from the right place already.
      setTotal(item.durationSec);
    } else if (streamingRef.current) {
      // The stream already starts where it should; the <video> just plays from its beginning.
      setTotal(item.durationSec);
      if (v.currentTime > 1) v.currentTime = 0; // Safari can open a live playlist near its edge
    } else {
      setTotal(v.duration || item.durationSec);
      if (resumeAt.current !== null) {
        // Another track: carry on from the same moment.
        v.currentTime = resumeAt.current;
        resumeAt.current = null;
      } else if (resumeStart(item.startAt, v.duration)) {
        v.currentTime = item.startAt;
      }
    }
    if (wantPlay.current) void v.play().catch(() => setControls(true));
    else setControls(true);
  };

  const onError = () => {
    if (castingRef.current) {
      // Ending the cast brings the video back here, where it can still play.
      toast.error(CAST_FAILED);
      stopCasting();
      return;
    }
    const err = videoRef.current?.error;
    // MKV is only a guess outside Safari: a file that won't open as it is gets streamed remuxed instead.
    if (err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED && src === item.src && !forceRemux) {
      resumeAt.current = videoRef.current?.currentTime || null;
      setForceRemux(true);
      return;
    }
    // Streams report through hls.js; Safari's own HLS lands here, so start again from this spot.
    if (streamingRef.current && err?.code === MediaError.MEDIA_ERR_NETWORK) {
      resumeAt.current = position();
      setRestartKey((k) => k + 1);
      return;
    }
    setError(
      err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? "This browser can't play this file."
        : err?.code === MediaError.MEDIA_ERR_NETWORK
          ? "The video stopped loading. Check your connection and try again."
          : "This video won't play here.",
    );
  };

  const onPlay = () => {
    setPlaying(true);
    wantPlay.current = true;
  };
  // A converted stream that keeps running dry means the server converts slower than it plays.
  const onWaiting = () => {
    setBuffering(true);
    if (plan?.kind === "transcode" && position() > offsetRef.current + 1 && ++stalls.current >= SLOW_AFTER_STALLS) setSlow(true);
  };
  const onPause = () => {
    setPlaying(false);
    wantPlay.current = false;
    setControls(true);
    save();
  };
  const onEnded = () => {
    setPlaying(false);
    setControls(true);
    save();
    if (!mini && next && !nextDismissed.current && item.autoplayNext) goNext();
  };
  /** The same handlers for the Chromecast, which sends the same events as the <video>. */
  const castEvents = useRef<Record<MediaEventName, () => void>>(null!);
  castEvents.current = {
    loadedmetadata: onLoaded,
    timeupdate: onTimeUpdate,
    play: onPlay,
    playing: () => setBuffering(false),
    waiting: onWaiting,
    pause: onPause,
    seeked: () => undefined,
    ended: onEnded,
    error: onError,
  };

  /** Leaves the player's page; the video carries on in the mini player. */
  const back = () => {
    save();
    if (window.history.length > 1) router.back();
    else router.push(item.backHref);
    // The page you go back to shows where you stopped.
    setTimeout(() => router.refresh(), 100);
  };
  backRef.current = back;

  /** Ends the video: from the mini player, or when it can't play. */
  const close = () => {
    save();
    closeVideo();
    if (!mini) back();
    else router.refresh();
  };

  /** Marks it watched and stops; the place saved on the way out would undo that, so it isn't. */
  const markWatched = async () => {
    setMoreOpen(false);
    try {
      await setFinished("video", item.progressId, item.durationSec, true);
      toast("Marked as watched");
      touched.current = false;
      close();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const heading = item.kind === "episode" ? item.showTitle : item.title;
  const subheading = item.kind === "episode" ? `${item.label}, ${item.title}` : null;
  const tracks = item.file.audioTracks;
  const currentTrack = track ?? defaultAudioTrack(item.file);
  const audioButton =
    tracks.length > 1 ? (
      <button type="button" className="icon-btn" aria-label="Audio" onClick={() => setAudioOpen(true)}>
        <AudioTrackIcon />
      </button>
    ) : null;

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        pull.ref.current = el;
      }}
      className={mini ? "mini vp-mini" : `vp ${item.next.length ? "vp-has-next" : ""} ${controls ? "vp-show" : ""} ${fullscreen || sideways ? "vp-over" : ""} ${pull.pulled ? "pulled" : ""}`}
      style={{ "--tint": item.color ?? "#3b4a6e" } as React.CSSProperties}
      role={mini ? "region" : undefined}
      aria-label={mini ? "Now watching" : undefined}
      onPointerMove={(e) => e.pointerType === "mouse" && poke()}
      onPointerLeave={(e) => e.pointerType === "mouse" && playing && setControls(false)}
    >
      <div className="vp-head player-top player-pull" {...pull.handlers}>
        <button type="button" className="icon-btn" aria-label="Close player" onClick={back}>
          <DownIcon />
        </button>
        <div className="player-from">{castDevice ? `Playing on ${castDevice}` : `Playing from ${item.kind === "movie" ? "Movies" : "Shows"}`}</div>
        <div className="player-top-end">
          <CastButton />
          <button type="button" className="icon-btn" aria-label="More options" onClick={() => setMoreOpen(true)}>
            <MoreIcon />
          </button>
        </div>
      </div>

      <div className="vp-stage" onClick={onStageTap}>
        {casting ? (
          // The picture is on the TV; here, its backdrop with the cast mark.
          <div className="vp-cast">
            {item.art ? <img src={item.art} alt="" /> : null}
            <CastIcon size={44} />
          </div>
        ) : src || stream ? (
          <video
            key={src ?? stream?.sessionId}
            ref={videoRef}
            className="vp-video"
            src={src ?? undefined}
            playsInline
            preload="metadata"
            onLoadedMetadata={onLoaded}
            onTimeUpdate={onTimeUpdate}
            onPlay={onPlay}
            onPlaying={() => setBuffering(false)}
            onCanPlay={() => setBuffering(false)}
            onWaiting={onWaiting}
            onPause={onPause}
            onEnded={onEnded}
            onError={onError}
          />
        ) : null}

        <div className="vp-overlay">
          <div className="vp-top">
            <button type="button" className="icon-btn" aria-label="Close player" onClick={back}>
              <DownIcon />
            </button>
            <div className="vp-titles">
              <div className="vp-title">{heading}</div>
              {subheading ? <div className="vp-sub">{subheading}</div> : null}
            </div>
          </div>
        </div>

        {slowCard}
        {countdown !== null && next ? (
          <div className="vp-next">
            <button type="button" className="vp-next-main" onClick={goNext}>
              <Still videoId={next.id} hash={next.stillHash} title={next.title} />
              <span className="vp-next-text">
                <span className="eyebrow">{item.autoplayNext ? `Next in ${countdown}` : "Next episode"}</span>
                <span className="vp-next-title">
                  {next.title}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Keep watching"
              onClick={() => {
                nextDismissed.current = true;
                setCountdown(null);
              }}
            >
              <CloseIcon size={20} />
            </button>
          </div>
        ) : null}
      </div>

      {/* Under the video when upright, laid out like the audio player; the controls sit along the bottom of the picture sideways or in full screen. */}
      <div className="vp-main">
        <div className="player-info-row vp-info">
          <div className="player-info">
            <h1 className="player-title">{item.title}</h1>
            {item.kind === "episode" ? (
              <div className="player-sub">
                {item.showTitle}, {item.label}
              </div>
            ) : null}
          </div>
          <VolumeControl />
        </div>
        <div className="vp-controls" onPointerDown={poke}>
          <Scrubber
            store={times}
            total={total}
            onScrub={(to) => {
              times.set({ time: to });
              seekTo(to, false);
              poke();
            }}
            onRelease={(to) => seekTo(to)}
          />
          <Times store={times} total={total} />
          <div className="player-controls">
            <button type="button" className="icon-btn dim" aria-label="Start over" onClick={() => seekTo(0)}>
              <PrevChapterIcon />
            </button>
            <button type="button" className="skip-btn" aria-label={`Skip back ${audio.skip.back} seconds`} onClick={() => skip(-audio.skip.back)}>
              <SkipBackIcon size={36} />
              <span>{audio.skip.back}</span>
            </button>
            <button
            type="button"
            className={`play-btn${buffering ? " buffering" : ""}`}
            aria-label={playing ? "Pause" : "Play"}
            onClick={toggle}
            disabled={!src && !stream}
          >
              {playing ? <PauseIcon size={32} /> : <PlayIcon size={32} />}
            </button>
            <button type="button" className="skip-btn" aria-label={`Skip forward ${audio.skip.forward} seconds`} onClick={() => skip(audio.skip.forward)}>
              <SkipForwardIcon size={36} />
              <span>{audio.skip.forward}</span>
            </button>
            <button type="button" className="icon-btn dim" aria-label="Next episode" onClick={goNext} disabled={!next}>
              <NextChapterIcon />
            </button>
          </div>
          {/* Sideways or in full screen: what the tiles hold, at the bottom right of the picture. */}
          <div className="vp-tools">
            <VolumeControl />
            {audioButton}
            {casting ? null : (
              <>
                <button type="button" className="icon-btn" aria-label="Picture in picture" onClick={pip}>
                  <PipIcon />
                </button>
                <button type="button" className="icon-btn" aria-label={fullscreen ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen}>
                  <FullscreenIcon exit={fullscreen} />
                </button>
              </>
            )}
          </div>
        </div>
        {/* The next episodes scroll here, so the tiles stay at the bottom. */}
        <div className="vp-scroll">
          {item.next.length ? (
            <section className="section vp-next-list">
              <h2 className="section-title">Next episodes</h2>
              <div>
                {item.next.slice(0, 10).map((e) => (
                  <Link key={e.id} className="episode-row-main episode-row" href={playHref("episode", e.id)} replace>
                    <div className="card-cover episode-still">
                      <Still videoId={e.id} hash={e.stillHash} title={e.title} />
                    </div>
                    <div className="list-row-main">
                      <span className="list-row-title">{e.title}</span>
                      <span className="list-row-sub">
                        {episodeLabel(e.season, e.episode)}, {duration(e.durationSec)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
        <div className="player-tiles vp-tiles">
          {slowCard}
          {tracks.length > 1 ? (
            <button type="button" className="tile" onClick={() => setAudioOpen(true)}>
              <AudioTrackIcon size={20} />
              <span>Audio</span>
            </button>
          ) : null}
          {/* The picture is on the TV while casting, so there's nothing to pop out or fill the screen with. */}
          {casting ? null : (
            <>
              <button type="button" className="tile" onClick={pip}>
                <PipIcon size={20} />
                <span>Pop out</span>
              </button>
              <button type="button" className="tile" onClick={toggleFullscreen} aria-pressed={fullscreen}>
                <FullscreenIcon size={20} exit={fullscreen} />
                <span>Full screen</span>
              </button>
            </>
          )}
        </div>
      </div>

      {mini ? (
        <div className="mini-row vp-mini-row">
          <Link className="mini-open" href={item.href} aria-label={`Open player: ${item.title}`}>
            <span className="mini-text">
              <span className="mini-title">{heading}</span>
              {castDevice ? (
                <span className="mini-sub mini-cast">
                  <CastIcon size={13} />
                  {castDevice}
                </span>
              ) : (
                <MiniSub store={times} total={total} label={item.label} />
              )}
            </span>
          </Link>
          <button type="button" className="mini-skip" onClick={() => skip(-audio.skip.back)} aria-label={`Skip back ${audio.skip.back} seconds`}>
            <SkipBackIcon size={30} />
            <span>{audio.skip.back}</span>
          </button>
          <button type="button" className={`icon-btn mini-play${buffering ? " buffering" : ""}`} onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button type="button" className="icon-btn" onClick={close} aria-label="Stop watching">
            <CloseIcon size={20} />
          </button>
          <MiniBar store={times} total={total} />
        </div>
      ) : null}

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title={item.title}>
        <SheetItem
          onClick={() => {
            setMoreOpen(false);
            save();
            router.push(item.backHref);
          }}
        >
          Go to {item.kind === "movie" ? "movie" : "show"}
        </SheetItem>
        {plan?.kind === "transcode" ? (
          <SheetItem
            onClick={() => {
              setMoreOpen(false);
              setQualityOpen(true);
            }}
          >
            <span style={{ flex: 1 }}>Quality</span>
            <span className="muted small">{QUALITY_LABEL[qualityShown]}</span>
          </SheetItem>
        ) : null}
        <SheetItem onClick={markWatched}>Mark as watched</SheetItem>
        <SheetItem
          onClick={() => {
            setMoreOpen(false);
            seekTo(0);
          }}
        >
          Start from the beginning
        </SheetItem>
        <SheetItem
          danger
          onClick={() => {
            setMoreOpen(false);
            close();
          }}
        >
          Stop watching
        </SheetItem>
      </Sheet>

      <QualitySheet open={qualityOpen} value={qualityShown} onClose={() => setQualityOpen(false)} onPick={pickQuality} />

      <Sheet open={audioOpen} onClose={() => setAudioOpen(false)} title="Audio">
        {tracks.map((t) => (
          <SheetItem key={t.index} active={t.index === currentTrack} onClick={() => pickTrack(t)}>
            <span style={{ flex: 1 }}>{trackName(t)}</span>
            <span className="muted small">{trackDetails(t)}</span>
          </SheetItem>
        ))}
      </Sheet>

      <Sheet open={!!error} onClose={close} title={error ?? ""}>
        <div className="vp-problem">
          <div className="pills">
            {[item.file.videoCodec ? codecName(item.file.videoCodec) : null, codecName(item.file.container)].filter(Boolean).map((f) => (
              <span key={f} className="pill">
                {f}
              </span>
            ))}
          </div>
          <div className="vp-problem-actions">
            <button type="button" className="btn btn-big" onClick={close}>
              Close
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
