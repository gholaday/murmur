import { useSyncExternalStore } from "react";
import {
  CastContext,
  type CastSession,
  CastState,
  MediaHlsSegmentFormat,
  MediaHlsVideoSegmentFormat,
  type MediaInfo,
  MediaPlayerIdleReason,
  MediaPlayerState,
  type MediaStatus,
  MediaStreamType,
  type RemoteMediaClient,
} from "react-native-google-cast";
import { apiPaths, type CastLinkDto, castContentType, castPrefix } from "@murmur/shared/client";
import { toast } from "@/components/toast";
import { absolute, api } from "@/lib/api";

// Chromecast: Google's Default Media Receiver on the TV, which fetches the media straight from the
// server. The audio engine and the video player stay in charge: while a session is up they play
// through a CastPlayer instead of their own player, so progress, ads, chapters and Up Next carry
// on. If the native module is missing or no device is found, nothing shows and playback is as before.

export interface CastStatus {
  /** A Chromecast was found on the network, or one is connected. */
  available: boolean;
  /** The connected device's name. */
  device: string | null;
}

let status: CastStatus = { available: false, device: null };
const listeners = new Set<() => void>();
const deviceListeners = new Set<(device: string | null) => void>();

function setStatus(change: Partial<CastStatus>) {
  const next = { ...status, ...change };
  if (next.available === status.available && next.device === status.device) return;
  const deviceChanged = next.device !== status.device;
  status = next;
  listeners.forEach((l) => l());
  if (deviceChanged) deviceListeners.forEach((l) => l(next.device));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const getCastStatus = () => status;
export const useCast = (): CastStatus => useSyncExternalStore(subscribe, getCastStatus);

/** Runs when casting starts (the device's name) or ends (null), for the players to hand over. */
export function onCastDevice(listener: (device: string | null) => void): () => void {
  deviceListeners.add(listener);
  return () => void deviceListeners.delete(listener);
}

/** The system device picker; with a device connected it offers Stop casting. */
export const pickCastDevice = () => void CastContext.showCastDialog().catch(() => undefined);

const endSession = () => void CastContext.getSessionManager().endCurrentSession(true).catch(() => undefined);

// ---------- The session ----------

let client: RemoteMediaClient | null = null;
let clientSubs: { remove: () => void }[] = [];
const players = new Set<CastPlayer>();

function connected(session: CastSession) {
  for (const s of clientSubs) s.remove();
  client = session.client;
  clientSubs = [
    client.onMediaStatusUpdated((s) => players.forEach((p) => p.status(s))),
    client.onMediaProgressUpdated((at, duration) => players.forEach((p) => p.progress(at, duration)), 1),
  ];
  void session.getCastDevice().then(
    (d) => setStatus({ device: d?.friendlyName || "Chromecast" }),
    () => setStatus({ device: "Chromecast" }),
  );
}

function disconnected() {
  for (const s of clientSubs) s.remove();
  clientSubs = [];
  client = null;
  setStatus({ device: null });
}

// Listened to for the app's whole life, so never removed.
try {
  const sessions = CastContext.getSessionManager();
  CastContext.onCastStateChanged((s) => setStatus({ available: s !== CastState.NO_DEVICES_AVAILABLE }));
  sessions.onSessionStarted(connected);
  sessions.onSessionResumed(connected);
  sessions.onSessionEnded(disconnected);
  void CastContext.getCastState().then((s) => s && setStatus({ available: s !== CastState.NO_DEVICES_AVAILABLE }), () => undefined);
  void sessions.getCurrentCastSession().then((s) => s && connected(s), () => undefined);
} catch {
  // No Cast support in this build or on this phone: the button never shows.
}

// ---------- Links ----------

const links = new Map<string, CastLinkDto>();

/** An absolute link the Chromecast can open for an API path, on the server address the app uses. */
async function castUrl(path: string, prefixes: string[]): Promise<string> {
  const key = prefixes.join(" ");
  let link = links.get(key);
  // A fresh link once this one is within the hour of running out, so a long item keeps playing.
  if (!link || link.expiresAt - Date.now() < 60 * 60 * 1000) {
    link = await api<CastLinkDto>(apiPaths.cast, { method: "POST", body: { paths: prefixes } });
    links.set(key, link);
  }
  return absolute(`${link.base}${path}`);
}

// ---------- The players' stand-in ----------

/** What the TV shows while it plays. */
export interface CastAbout {
  title: string;
  subtitle: string | null;
  /** An API path to the cover or backdrop, or null. */
  image: string | null;
}

export interface CastEvents {
  /** The media is on the TV (or was already, on a reconnect) at `position`. */
  loaded(): void;
  time(): void;
  playing(playing: boolean): void;
  buffering(buffering: boolean): void;
  ended(): void;
}

const sameMedia = (url: string | undefined, path: string) => !!url && url.split("?")[0]!.endsWith(path.split("?")[0]!);

/**
 * Plays an API path on the connected Chromecast and reports back like a local player would. The
 * audio engine and the video player each have one; only the one that loaded last hears the TV.
 */
export class CastPlayer {
  /** Where the TV is, in the media's own time. */
  position = 0;
  /** The media's length as the TV knows it (for a converted stream, what's made so far). */
  duration = 0;
  playing = false;
  private active = false;
  private loadId = 0;
  /** The media is on the TV and this player is hearing it. */
  get live() {
    return this.active;
  }
  private rate = 1;

  constructor(private on: CastEvents) {
    players.add(this);
  }

  /**
   * Sends `path` to the TV from `startAt`; if the TV is already playing it (a reconnect), picks
   * it up where the TV is instead. When the TV can't load it, says so and ends casting, which
   * brings the item back to the phone.
   */
  load(path: string, about: CastAbout, startAt: number, autoplay: boolean, rate = 1) {
    const id = ++this.loadId;
    this.active = false;
    this.rate = rate;
    const c = client;
    if (!c) return;
    void (async () => {
      try {
        const now = await c.getMediaStatus();
        if (id !== this.loadId) return;
        if (now && now.playerState !== MediaPlayerState.IDLE && sameMedia(now.mediaInfo?.contentUrl ?? now.mediaInfo?.contentId, path)) {
          this.position = now.streamPosition;
          this.duration = now.mediaInfo?.streamDuration ?? 0;
          this.playing = now.playerState === MediaPlayerState.PLAYING;
          this.active = true;
          this.on.loaded();
          return;
        }
        const prefixes = [castPrefix(path), ...(about.image ? [castPrefix(about.image)] : [])];
        const url = await castUrl(path, prefixes);
        const image = about.image ? await castUrl(about.image, prefixes) : null;
        const hls = path.includes(".m3u8");
        const mediaInfo: MediaInfo = {
          contentUrl: url,
          contentId: url,
          contentType: castContentType(path),
          streamType: MediaStreamType.BUFFERED,
          ...(hls ? { hlsSegmentFormat: MediaHlsSegmentFormat.FMP4, hlsVideoSegmentFormat: MediaHlsVideoSegmentFormat.FMP4 } : {}),
          metadata: { type: "generic", title: about.title, ...(about.subtitle ? { subtitle: about.subtitle } : {}), images: image ? [{ url: image }] : [] },
        };
        await c.loadMedia({ mediaInfo, autoplay, startTime: startAt, playbackRate: rate });
        if (id !== this.loadId) return;
        this.position = startAt;
        this.playing = autoplay;
        this.active = true;
        this.on.loaded();
      } catch {
        if (id === this.loadId) this.failed();
      }
    })();
  }

  play() {
    this.playing = true;
    if (this.active) void client?.play().catch(() => undefined);
  }

  pause() {
    this.playing = false;
    if (this.active) void client?.pause().catch(() => undefined);
  }

  seek(sec: number) {
    if (!this.active) return;
    this.position = sec;
    void client?.seek({ position: sec }).catch(() => undefined);
  }

  setRate(rate: number) {
    this.rate = rate;
    if (this.active) void client?.setPlaybackRate(rate).catch(() => undefined);
  }

  /** Stops the TV too, rather than leaving it paused: the player was closed or stopped. */
  stop() {
    this.loadId++;
    if (this.active) void client?.stop().catch(() => undefined);
    this.active = false;
    this.playing = false;
  }

  /** Lets go of the TV's player without stopping it, when casting ends. */
  release() {
    this.loadId++;
    this.active = false;
    this.playing = false;
  }

  /** From the session: the TV's player changed state. */
  status(s: MediaStatus | null) {
    if (!this.active || !s) return;
    if (s.mediaInfo?.streamDuration) this.duration = s.mediaInfo.streamDuration;
    switch (s.playerState) {
      case MediaPlayerState.PLAYING:
      case MediaPlayerState.PAUSED: {
        const playing = s.playerState === MediaPlayerState.PLAYING;
        this.on.buffering(false);
        if (playing !== this.playing) {
          this.playing = playing;
          this.on.playing(playing);
        }
        break;
      }
      case MediaPlayerState.BUFFERING:
      case MediaPlayerState.LOADING:
        this.on.buffering(true);
        break;
      case MediaPlayerState.IDLE:
        if (s.idleReason === MediaPlayerIdleReason.FINISHED) {
          this.active = false;
          this.playing = false;
          this.on.ended();
        } else if (s.idleReason === MediaPlayerIdleReason.ERROR) {
          this.failed();
        }
        break;
    }
  }

  /** From the session: where the TV is, about every second. */
  progress(at: number, duration: number) {
    if (!this.active) return;
    this.position = at;
    if (duration > 0) this.duration = duration;
    this.on.time();
  }

  private failed() {
    this.active = false;
    this.playing = false;
    toast.error("The Chromecast couldn't play this from this address.");
    endSession();
  }
}
