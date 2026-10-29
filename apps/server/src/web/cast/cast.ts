"use client";

import { useSyncExternalStore } from "react";
import { apiPaths, type CastLinkDto, castContentType, castPrefix } from "@murmur/shared/client";
import { api } from "../api";

/**
 * Chromecast on the web: Google's sender SDK, loaded in Chromium browsers only, and Google's own
 * receiver on the TV. The players stay in charge: while a session is up they play through a
 * CastMedia instead of their <audio> or <video>, so progress, ads, chapters and Up Next carry on.
 * If the SDK never loads or no device is found, nothing shows and playback is as before.
 */

export interface CastState {
  /** A Chromecast was found on the network, or one is connected. */
  available: boolean;
  /** The connected device's name. */
  device: string | null;
}

let state: CastState = { available: false, device: null };
const listeners = new Set<() => void>();
const set = (next: CastState) => {
  if (next.available === state.available && next.device === state.device) return;
  state = next;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const NONE: CastState = { available: false, device: null };

export const castStore = { get: () => state, subscribe };

export function useCast(): CastState {
  return useSyncExternalStore(subscribe, castStore.get, () => NONE);
}

let started = false;
let remote: { player: cast.framework.RemotePlayer; controller: cast.framework.RemotePlayerController } | null = null;

/** Loads the SDK once. Only Chromium browsers can cast; others never fetch anything. */
export function startCast() {
  if (started || typeof window === "undefined" || !window.chrome) return;
  started = true;
  window.__onGCastApiAvailable = (available) => {
    if (!available) return;
    const ctx = cast.framework.CastContext.getInstance();
    ctx.setOptions({
      receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    });
    const player = new cast.framework.RemotePlayer();
    remote = { player, controller: new cast.framework.RemotePlayerController(player) };
    const update = () => {
      const s = ctx.getCastState();
      const session = s === cast.framework.CastState.CONNECTED ? ctx.getCurrentSession() : null;
      set({ available: s !== cast.framework.CastState.NO_DEVICES_AVAILABLE, device: session?.getCastDevice().friendlyName ?? null });
    };
    ctx.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, update);
    update();
  };
  const script = document.createElement("script");
  script.src = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
  script.async = true;
  document.head.append(script);
}

/** Chrome's device picker; with a device connected it offers Stop casting. */
export function pickCastDevice() {
  void cast.framework.CastContext.getInstance()
    .requestSession()
    .catch(() => undefined);
}

/** When the TV can't load an item; the cast ends and the item comes back to this device. */
export const CAST_FAILED = "The Chromecast couldn't play this from this address.";

export function stopCasting() {
  if (state.device) cast.framework.CastContext.getInstance().endCurrentSession(true);
}

// ---------- Links ----------

const links = new Map<string, CastLinkDto>();

/** An absolute link the Chromecast can open for an API path, on the address this page is using. */
async function castUrl(path: string, prefixes: string[]): Promise<string> {
  const key = prefixes.join(" ");
  let link = links.get(key);
  // A fresh link once this one is within the hour of running out, so a long item keeps playing.
  if (!link || link.expiresAt - Date.now() < 60 * 60 * 1000) {
    link = await api<CastLinkDto>(apiPaths.cast, { method: "POST", body: { paths: prefixes } });
    links.set(key, link);
  }
  return `${window.location.origin}${link.base}${path}`;
}

// ---------- The player's stand-in for <audio> and <video> ----------

/** What the TV shows while it plays. */
export interface CastDescription {
  title: string;
  subtitle: string | null;
  /** An API path to the cover or backdrop, or null. */
  image: string | null;
}

const MEDIA_NS = "urn:x-cast:com.google.cast.media";

/**
 * Looks enough like an HTMLMediaElement for the players: set `src`, then `load()`, `play()`,
 * `pause()`, `currentTime`, and the same events (loadedmetadata, timeupdate, play, pause, waiting,
 * playing, seeked, ended, error). Behind it, Google's player on the TV.
 */
export class CastMedia extends EventTarget {
  /** Where the next load starts, so it doesn't play from 0 and then jump. */
  startAt = 0;
  autoplay = false;
  preload = "auto";
  private source = "";
  private wantRate = 1;
  private lastTime = 0;
  private loadId = 0;
  private wasActive = false;
  private adopting = false;

  private onChange = (e: { field: string }) => this.changed(e.field);

  constructor(private describe: () => CastDescription | null) {
    super();
    remote?.controller.addEventListener(cast.framework.RemotePlayerEventType.ANY_CHANGE, this.onChange);
  }

  /** Stops listening to the TV for good, when the player that made this goes away. */
  dispose() {
    this.release();
    remote?.controller.removeEventListener(cast.framework.RemotePlayerEventType.ANY_CHANGE, this.onChange);
  }

  get src() {
    return this.source;
  }
  set src(path: string) {
    this.source = path;
  }
  getAttribute(name: string) {
    return name === "src" && this.source ? this.source : null;
  }
  removeAttribute(name: string) {
    if (name === "src") this.source = "";
  }

  get paused() {
    return !remote?.player.isMediaLoaded || remote.player.isPaused || remote.player.playerState === "IDLE";
  }
  get currentTime() {
    return remote?.player.currentTime ?? 0;
  }
  set currentTime(t: number) {
    if (!remote || this.adopting || Math.abs(t - remote.player.currentTime) < 1) return;
    remote.player.currentTime = t;
    remote.controller.seek();
    this.lastTime = t;
    queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
  }
  get duration() {
    return remote?.player.duration || Number.NaN;
  }
  get playbackRate() {
    return this.wantRate;
  }
  set playbackRate(rate: number) {
    this.wantRate = rate;
    this.sendRate();
  }
  /** How far a converted stream has been made: what the TV reports as its length so far. */
  get seekable(): Pick<TimeRanges, "length" | "end"> {
    const end = Number.isFinite(this.duration) ? this.duration : this.currentTime;
    return { length: 1, end: () => end };
  }
  get buffered(): Pick<TimeRanges, "length" | "end"> {
    return { length: 0, end: () => 0 };
  }
  readonly error = null;
  /** The TV's mute stays the TV's; the page's mute button doesn't reach it. */
  muted = false;
  get volume() {
    return remote?.player.volumeLevel ?? 1;
  }
  set volume(v: number) {
    if (!remote || Math.abs(remote.player.volumeLevel - v) < 0.01) return;
    remote.player.volumeLevel = v;
    remote.controller.setVolumeLevel();
  }

  /** Sends `src` to the TV, starting at `startAt`; if the TV is already playing it (a reconnect), picks it up there instead. */
  load() {
    const session = cast.framework.CastContext.getInstance().getCurrentSession();
    const path = this.source;
    if (!path) {
      // Emptied (the player was closed or stopped): the TV stops too, rather than sitting paused.
      this.loadId++;
      if (this.wasActive) remote?.controller.stop();
      this.wasActive = false;
      return;
    }
    if (!session) return;
    const id = ++this.loadId;
    const playing = session.getMediaSession();
    if (remote?.player.isMediaLoaded && playing?.playerState !== "IDLE" && playing?.media?.contentId.split("?")[0]!.endsWith(path.split("?")[0]!)) {
      this.wasActive = true;
      this.lastTime = remote.player.currentTime;
      // The player sets currentTime as it hears loadedmetadata; the TV's own place wins.
      this.adopting = true;
      this.dispatchEvent(new Event("loadedmetadata"));
      this.adopting = false;
      this.dispatchEvent(new Event(remote.player.isPaused ? "pause" : "play"));
      this.dispatchEvent(new Event("timeupdate"));
      return;
    }
    const about = this.describe();
    const image = about?.image ?? null;
    const prefixes = [castPrefix(path), ...(image ? [castPrefix(image)] : [])];
    void (async () => {
      try {
        const url = await castUrl(path, prefixes);
        const info = new chrome.cast.media.MediaInfo(url, castContentType(path));
        info.contentUrl = url;
        info.streamType = chrome.cast.media.StreamType.BUFFERED;
        if (path.includes(".m3u8")) {
          info.hlsSegmentFormat = chrome.cast.media.HlsSegmentFormat.FMP4;
          info.hlsVideoSegmentFormat = chrome.cast.media.HlsVideoSegmentFormat.FMP4;
        }
        const meta = new chrome.cast.media.GenericMediaMetadata();
        meta.title = about?.title ?? "";
        if (about?.subtitle) meta.subtitle = about.subtitle;
        if (image) meta.images = [new chrome.cast.Image(await castUrl(image, prefixes))];
        info.metadata = meta;
        const request = new chrome.cast.media.LoadRequest(info);
        request.autoplay = this.autoplay;
        request.currentTime = this.startAt;
        await session.loadMedia(request);
        if (id !== this.loadId) return;
        this.lastTime = this.startAt;
        this.wasActive = true;
        this.sendRate();
        this.dispatchEvent(new Event("loadedmetadata"));
        if (this.autoplay) this.dispatchEvent(new Event("play"));
      } catch {
        if (id === this.loadId) this.dispatchEvent(new Event("error"));
      }
    })();
  }

  play(): Promise<void> {
    this.autoplay = true;
    if (remote?.player.isMediaLoaded && remote.player.isPaused) remote.controller.playOrPause();
    return Promise.resolve();
  }
  pause() {
    this.autoplay = false;
    if (remote?.player.isMediaLoaded && !remote.player.isPaused) remote.controller.playOrPause();
  }

  /** Lets go of the TV's player without stopping it, when casting ends or the item changes hands. */
  release() {
    this.loadId++;
    this.source = "";
    this.wasActive = false;
  }

  private sendRate() {
    const session = cast.framework.CastContext.getInstance().getCurrentSession();
    const media = session?.getMediaSession();
    if (!session || !media) return;
    void session
      .sendMessage(MEDIA_NS, { type: "SET_PLAYBACK_RATE", playbackRate: this.wantRate, mediaSessionId: media.mediaSessionId, requestId: 0 })
      .catch(() => undefined);
  }

  private changed(field: string) {
    if (!this.wasActive || !remote) return;
    const p = remote.player;
    if (field === "currentTime" && p.currentTime !== this.lastTime) {
      this.lastTime = p.currentTime;
      this.dispatchEvent(new Event("timeupdate"));
    } else if (field === "isPaused") {
      this.dispatchEvent(new Event(p.isPaused ? "pause" : "play"));
    } else if (field === "playerState") {
      if (p.playerState === "BUFFERING") this.dispatchEvent(new Event("waiting"));
      else if (p.playerState === "PLAYING") this.dispatchEvent(new Event("playing"));
      else if (p.playerState === "IDLE" || p.playerState === null) {
        const reason = cast.framework.CastContext.getInstance().getCurrentSession()?.getMediaSession()?.idleReason;
        // The media session can be gone by the time it's idle, so reaching the end counts too.
        const atEnd = Number.isFinite(p.duration) && p.duration > 0 && this.lastTime >= p.duration - 2;
        if (reason === "FINISHED" || (reason == null && atEnd)) {
          this.wasActive = false;
          this.dispatchEvent(new Event("ended"));
        } else if (reason === "ERROR") {
          this.wasActive = false;
          this.dispatchEvent(new Event("error"));
        }
      }
    }
  }
}

/** The media events the players listen for, on an <audio>, a <video> or a CastMedia. */
export const MEDIA_EVENTS = ["loadedmetadata", "waiting", "playing", "timeupdate", "play", "pause", "seeked", "ended", "error"] as const;
export type MediaEventName = (typeof MEDIA_EVENTS)[number];
