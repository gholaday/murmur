"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiPaths,
  channelsLabel,
  clock,
  codecName,
  defaultAudioTrack,
  duration,
  episodeLabel,
  errorText,
  type PlaybackPlan,
  playbackPlan,
  type StreamRequest,
  type StreamSessionDto,
  timeLeft,
  type UserPrefs,
  type VideoQuality,
  VIDEO_SPEEDS,
  type VideoAudioTrack,
  type VideoEpisode,
  type VideoFileInfo,
  WATCHED_AT,
} from "@murmur/shared/client";
import { toast } from "sonner";
import { api } from "../api";
import {
  AudioTrackIcon,
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
import { usePlayer } from "../player/engine";
import { usePullToClose } from "../player/full-player";
import { effectiveVolume, useVolume } from "../player/volume";
import { VolumeControl } from "../player/volume-control";
import { setFinished } from "../progress";
import { Sheet, SheetItem } from "../sheet";
import { percentDone, playHref, Still } from "./cards";
import { QUALITY_LABEL, QualitySheet } from "./quality-pick";
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
  /** A converted-video quality picked for this one before playing; null means your setting. */
  quality: VideoQuality | null;
  src: string;
  file: VideoFileInfo;
  durationSec: number;
  /** Where to resume; 0 starts from the beginning. */
  startAt: number;
  /** The movie or show page, for Back when the player was opened directly. */
  backHref: string;
  /** Episodes: the rest of the show, next one first. */
  next: VideoEpisode[];
  /** Speed is remembered per movie and per show. */
  speedKey: string;
}

const HIDE_AFTER_MS = 3000;
/** A phone on its side; a laptop window this short is rare enough to treat the same. */
const SIDEWAYS_PHONE = "(orientation: landscape) and (max-height: 600px)";
const SAVE_EVERY_MS = 10_000;
/** The next-episode card shows this long before the end, and counts down from COUNTDOWN. */
const NEXT_CARD_AT_SEC = 30;
const COUNTDOWN = 10;
const DOUBLE_TAP_MS = 300;

function readSpeed(key: string): number {
  try {
    const v = Number(localStorage.getItem(`murmur.videoSpeed.${key}`));
    return VIDEO_SPEEDS.includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

function saveSpeed(key: string, speed: number) {
  try {
    if (speed === 1) localStorage.removeItem(`murmur.videoSpeed.${key}`);
    else localStorage.setItem(`murmur.videoSpeed.${key}`, String(speed));
  } catch {
    // Private windows can refuse storage; the speed just isn't remembered.
  }
}

const speedLabel = (s: number) => `${s}x`;

/** Tells the server a stream is done with, so ffmpeg stops; nothing to do if that fails. */
function endStream(sessionId: string) {
  void api(apiPaths.streamSession(sessionId), { method: "DELETE", keepalive: true }).catch(() => undefined);
}

/** Seeks within a stream stay this far from its live edge, so the player doesn't stall there. */
const EDGE_SEC = 2;
/** This many stalls on a converted stream and the player says the server can't keep up. */
const SLOW_AFTER_STALLS = 3;

/** The audio language picked for a movie or show, so its next file opens with the same one. */
function readLanguage(key: string): string | null {
  try {
    return localStorage.getItem(`murmur.videoAudio.${key}`);
  } catch {
    return null;
  }
}

function saveLanguage(key: string, language: string | null) {
  try {
    if (language) localStorage.setItem(`murmur.videoAudio.${key}`, language);
    else localStorage.removeItem(`murmur.videoAudio.${key}`);
  } catch {
    // Not remembered in a private window.
  }
}

/** The remembered language's track, when the file has one and it isn't already the default. */
function rememberedTrack(file: VideoFileInfo, key: string): number | null {
  const language = readLanguage(key);
  const main = file.audioTracks.find((t) => t.index === defaultAudioTrack(file));
  if (!language || main?.language === language) return null;
  return file.audioTracks.find((t) => t.language === language)?.index ?? null;
}

let languageNames: Intl.DisplayNames | null = null;
/** "English" for "eng"; the track's title, or its number, when the file doesn't say. */
function trackName(t: VideoAudioTrack): string {
  let language: string | null = null;
  if (t.language && t.language !== "und") {
    try {
      languageNames ??= new Intl.DisplayNames(undefined, { type: "language" });
      language = languageNames.of(t.language) ?? null;
    } catch {
      language = t.language.toUpperCase();
    }
  }
  if (language && t.title && !t.title.toLowerCase().includes(language.toLowerCase())) return `${language}, ${t.title}`;
  return t.title ?? language ?? `Track ${t.index + 1}`;
}

const trackDetails = (t: VideoAudioTrack) => [codecName(t.codec), channelsLabel(t.channels)].filter(Boolean).join(" ");

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
  /** Null until the support check ran (it needs the browser). */
  const [plan, setPlan] = useState<PlaybackPlan | null>(null);
  // The player only renders in the browser (the shell opens it), so storage can be read up front.
  /** The audio track picked; null plays the default one. */
  const [track, setTrack] = useState<number | null>(() => rememberedTrack(item.file, item.speedKey));
  /** The file was tried as it is and wouldn't open. */
  const [forceRemux, setForceRemux] = useState(false);
  /** The file played as it is; null while streaming or before it's known. */
  const [src, setSrc] = useState<string | null>(null);
  /** The stream playing, when the file isn't played as it is. */
  const [stream, setStream] = useState<StreamSessionDto | null>(null);
  /** A converted stream keeps running dry: the server can't keep up. */
  const [slow, setSlow] = useState(false);
  const stalls = useRef(0);
  /** Waiting for the stream to start, or for the next piece. */
  const [buffering, setBuffering] = useState(false);
  /** The quality picked for this video, else your setting, read when the first converted stream starts; null until then. */
  const qualityRef = useRef<VideoQuality | null>(item.quality);
  const [qualityOpen, setQualityOpen] = useState(false);
  /** Shown in the sheets once a converted stream has read it. */
  const [qualityShown, setQualityShown] = useState<VideoQuality>(item.quality ?? "full");
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
  const [time, setTime] = useState(item.startAt);
  const [total, setTotal] = useState(item.durationSec);
  const [buffered, setBuffered] = useState(0);
  const [controls, setControls] = useState(true);
  const [speed, setSpeed] = useState(() => readSpeed(item.speedKey));
  const [speedOpen, setSpeedOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const nextDismissed = useRef(false);
  const touched = useRef(false);
  const lastTap = useRef({ at: 0, x: 0 });
  const next = item.next[0] ?? null;

  // A video takes over from whatever audio was on: it saves its place and leaves the mini player.
  const stopAudio = useRef(audio.stop);
  useEffect(() => {
    stopAudio.current();
  }, []);
  // And playing audio later ends the video.
  const audioAtStart = useRef(audio.item);
  const { close: closeVideo } = video;
  useEffect(() => {
    if (audio.item && audio.item !== audioAtStart.current) closeVideo();
  }, [audio.item, closeVideo]);

  // Plays the file as it is when the browser can, or starts a stream from where you are.
  useEffect(() => {
    const p = playbackPlan(item.file, browserSupport(item.file), { track, forceRemux });
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
    const first = item.startAt > 0 && item.startAt < item.durationSec * WATCHED_AT ? item.startAt : 0;
    const from = resumeAt.current ?? first;
    resumeAt.current = null;
    let cancelled = false;
    let started: string | null = null;
    // A converted picture is made at your chosen quality, read once from your settings.
    const quality: Promise<VideoQuality | undefined> =
      p.kind !== "transcode"
        ? Promise.resolve(undefined)
        : qualityRef.current
          ? Promise.resolve(qualityRef.current)
          : api<UserPrefs>(apiPaths.prefs).then(
              (prefs) => {
                setQualityShown(prefs.videoQuality);
                return (qualityRef.current = prefs.videoQuality);
              },
              () => "full" as const,
            );
    quality
      .then((q) => {
        if (cancelled) return;
        const body: StreamRequest = { track: p.track, audio: p.audio, video: p.kind === "transcode" ? "h264" : "copy", quality: q, start: from };
        return api<StreamSessionDto>(apiPaths.videoStream(item.videoId), { method: "POST", body });
      })
      .then((s) => {
        if (!s) return;
        started = s.sessionId;
        if (cancelled) return endStream(s.sessionId);
        offsetRef.current = s.start;
        setTime(s.start);
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
  }, [item.file, item.src, item.videoId, item.startAt, item.durationSec, track, forceRemux, restartKey]);

  // Hands the stream to the <video>: Safari plays HLS itself, other browsers through hls.js.
  useEffect(() => {
    const v = videoRef.current;
    if (!stream || !v) return;
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
      const h = new Hls({ startPosition: 0, maxBufferLength: 30, backBufferLength: 60 });
      let recovered = false;
      h.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        console.warn("stream failed", data.type, data.details, data.error?.message, data.mimeType ?? "");
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // Usually a session that ended while paused a long time: start again from here.
          resumeAt.current = offsetRef.current + v.currentTime;
          setRestartKey((k) => k + 1);
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
  }, [stream]);

  /** Where you are in the video: the <video>'s clock, plus where a stream started. */
  const position = useCallback(() => offsetRef.current + (videoRef.current?.currentTime ?? 0), []);

  /**
   * Moves to a point in the video. A stream only has what ffmpeg has made so far from where it
   * started; anywhere else needs a new stream from there, which `restart` allows (the scrubber
   * waits for release so dragging doesn't start one per pixel).
   */
  const seekTo = useCallback(
    (t: number, restart = true) => {
      const v = videoRef.current;
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
    [total],
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

  // The volume slider is this device's, shared with the audio player.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = effectiveVolume(volume);
    v.muted = volume.muted;
  }, [volume, src, stream]);

  /** Another audio track: remembered by language, and picks up where you are. */
  const pickTrack = (t: VideoAudioTrack) => {
    setAudioOpen(false);
    const current = track ?? defaultAudioTrack(item.file);
    if (t.index === current) return;
    resumeAt.current = position();
    saveLanguage(item.speedKey, t.language);
    setTrack(t.index === defaultAudioTrack(item.file) ? null : t.index);
  };

  /** Saves your place; nothing is saved until you've actually watched or moved, so opening and closing changes nothing. */
  const save = useCallback(
    (keepalive = false) => {
      const v = videoRef.current;
      if (!v || !touched.current) return;
      // A stream's <video> only knows the part made so far; the file's length comes from the server.
      const length = streamingRef.current ? item.durationSec : v.duration;
      if (!Number.isFinite(length) || !length) return;
      const at = position();
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
    [item.progressId, item.durationSec, position],
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
    if (!controls || !playing || speedOpen) return;
    const timer = setTimeout(() => setControls(false), HIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [controls, playing, speedOpen, pokedAt]);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);

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

  // The next-episode card counts down while the video plays, then starts the next one.
  useEffect(() => {
    if (countdown === null || !playing || mini) return;
    if (countdown <= 0) {
      goNext();
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown, playing, mini, goNext]);

  // Lock screen, media keys and the notification on phones.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({ title: item.title, artist: item.showTitle ?? "", album: item.label ?? "" });
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
      ["play", () => void videoRef.current?.play()],
      ["pause", () => videoRef.current?.pause()],
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
    const v = videoRef.current;
    if (!v) return;
    const at = position();
    setTime(at);
    if (Math.abs(at - item.startAt) > 3) touched.current = true;
    if (v.buffered.length) setBuffered(offsetRef.current + v.buffered.end(v.buffered.length - 1));
    const left = total - at;
    // The next episode only comes on by itself on the player's page, never from the mini player.
    if (!mini && next && countdown === null && !nextDismissed.current && left > 0 && left <= NEXT_CARD_AT_SEC) setCountdown(COUNTDOWN);
  };

  const onLoaded = () => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = speed;
    if (streamingRef.current) {
      // The stream already starts where it should; the <video> just plays from its beginning.
      setTotal(item.durationSec);
      if (v.currentTime > 1) v.currentTime = 0; // Safari can open a live playlist near its edge
    } else {
      setTotal(v.duration || item.durationSec);
      if (resumeAt.current !== null) {
        // Another track: carry on from the same moment.
        v.currentTime = resumeAt.current;
        resumeAt.current = null;
      } else if (item.startAt > 0 && item.startAt < v.duration * WATCHED_AT) {
        // A finished movie, or one with only the credits left, starts over.
        v.currentTime = item.startAt;
      }
    }
    if (wantPlay.current) void v.play().catch(() => setControls(true));
    else setControls(true);
  };

  const onError = () => {
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

  const changeSpeed = (s: number) => {
    setSpeed(s);
    saveSpeed(item.speedKey, s);
    if (videoRef.current) videoRef.current.playbackRate = s;
    setSpeedOpen(false);
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

  const left = Math.max(0, total - time);
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
      className={mini ? "mini vp-mini" : `vp ${controls ? "vp-show" : ""} ${fullscreen || sideways ? "vp-over" : ""} ${pull.pulled ? "pulled" : ""}`}
      style={{ "--tint": item.color ?? "#3b4a6e" } as React.CSSProperties}
      role={mini ? "region" : undefined}
      aria-label={mini ? "Now watching" : undefined}
      onPointerMove={(e) => e.pointerType === "mouse" && poke()}
      onPointerLeave={(e) => e.pointerType === "mouse" && playing && !speedOpen && setControls(false)}
    >
      <div className="vp-head player-top player-pull" {...pull.handlers}>
        <button type="button" className="icon-btn" aria-label="Close player" onClick={back}>
          <DownIcon />
        </button>
        <div className="player-from">Playing from {item.kind === "movie" ? "Movies" : "Shows"}</div>
        <button type="button" className="icon-btn" aria-label="More options" onClick={() => setMoreOpen(true)}>
          <MoreIcon />
        </button>
      </div>

      <div className="vp-stage" onClick={onStageTap}>
        {src || stream ? (
          <video
            key={src ?? stream?.sessionId}
            ref={videoRef}
            className="vp-video"
            src={src ?? undefined}
            playsInline
            preload="metadata"
            onLoadedMetadata={onLoaded}
            onTimeUpdate={onTimeUpdate}
            onPlay={() => {
              setPlaying(true);
              wantPlay.current = true;
            }}
            onPlaying={() => setBuffering(false)}
            onCanPlay={() => setBuffering(false)}
            // A converted stream that keeps running dry means the server converts slower than it plays.
            onWaiting={() => {
              setBuffering(true);
              if (plan?.kind === "transcode" && position() > offsetRef.current + 1 && ++stalls.current >= SLOW_AFTER_STALLS) setSlow(true);
            }}
            onPause={() => {
              setPlaying(false);
              wantPlay.current = false;
              setControls(true);
              save();
            }}
            onEnded={() => {
              setPlaying(false);
              setControls(true);
              save();
              if (!mini && next && !nextDismissed.current) goNext();
            }}
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

        {countdown !== null && next ? (
          <div className="vp-next">
            <button type="button" className="vp-next-main" onClick={goNext}>
              <Still videoId={next.id} hash={next.stillHash} title={next.title} />
              <span className="vp-next-text">
                <span className="eyebrow">Next in {countdown}</span>
                <span className="vp-next-title">
                  {next.episode}. {next.title}
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
          <input
            type="range"
            className="vp-scrub"
            aria-label="Position"
            min={0}
            max={total || 1}
            step={1}
            value={Math.min(time, total || 0)}
            style={
              {
                "--played": `${percentDone(time, total)}%`,
                "--loaded": `${percentDone(buffered, total)}%`,
              } as React.CSSProperties
            }
            onChange={(e) => {
              const to = Number(e.target.value);
              setTime(to);
              seekTo(to, false);
              poke();
            }}
            // A spot the stream hasn't made yet starts a new one once you let go.
            onPointerUp={(e) => seekTo(Number(e.currentTarget.value))}
            onKeyUp={(e) => seekTo(Number(e.currentTarget.value))}
          />
          <div className="vp-times">
            <span className="vp-time">{clock(time)}</span>
            <span className="vp-time vp-note">
            {slow ? (
              <>
                Converting slower than it plays
                {qualityRef.current !== "light" ? (
                  <button type="button" className="more-link vp-note-link" onClick={lowerQuality}>
                    Lower quality
                  </button>
                ) : null}
              </>
            ) : (
              timeLeft(total, time)
            )}
          </span>
            <span className="vp-time">-{clock(left)}</span>
          </div>
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
            <button type="button" className="vp-pill" aria-label={`Speed ${speedLabel(speed)}`} onClick={() => setSpeedOpen(true)}>
              {speedLabel(speed)}
            </button>
            <VolumeControl />
            {audioButton}
            <button type="button" className="icon-btn" aria-label="Picture in picture" onClick={pip}>
              <PipIcon />
            </button>
            <button type="button" className="icon-btn" aria-label={fullscreen ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen}>
              <FullscreenIcon exit={fullscreen} />
            </button>
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
                      <span className="list-row-title">
                        {e.episode}. {e.title}
                      </span>
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
          <button type="button" className="tile" onClick={() => setSpeedOpen(true)}>
            <strong>{speedLabel(speed)}</strong>
            <span>Speed</span>
          </button>
          {tracks.length > 1 ? (
            <button type="button" className="tile" onClick={() => setAudioOpen(true)}>
              <AudioTrackIcon size={20} />
              <span>Audio</span>
            </button>
          ) : null}
          <button type="button" className="tile" onClick={pip}>
            <PipIcon size={20} />
            <span>Pop out</span>
          </button>
          <button type="button" className="tile" onClick={toggleFullscreen} aria-pressed={fullscreen}>
            <FullscreenIcon size={20} exit={fullscreen} />
            <span>Full screen</span>
          </button>
        </div>
      </div>

      {mini ? (
        <div className="mini-row vp-mini-row">
          <Link className="mini-open" href={item.href} aria-label={`Open player: ${item.title}`}>
            <span className="mini-text">
              <span className="mini-title">{heading}</span>
              <span className="mini-sub">{item.label ? `${item.label}, ${timeLeft(total, time)}` : timeLeft(total, time)}</span>
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
          <div className="mini-bar" style={{ width: `${percentDone(time, total)}%` }} />
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

      <Sheet open={speedOpen} onClose={() => setSpeedOpen(false)} title="Speed">
        {VIDEO_SPEEDS.map((s) => (
          <SheetItem key={s} active={s === speed} onClick={() => changeSpeed(s)}>
            {speedLabel(s)}
          </SheetItem>
        ))}
      </Sheet>

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
