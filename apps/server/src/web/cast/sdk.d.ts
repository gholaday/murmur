// The parts of Google's Cast sender SDK (cast_sender.js with the Cast framework) Murmur uses.
// Loaded at run time from gstatic in Chromium browsers only; see cast.ts.

declare namespace chrome.cast {
  enum AutoJoinPolicy {
    ORIGIN_SCOPED = "origin_scoped",
  }
  class Image {
    constructor(url: string);
  }
  namespace media {
    const DEFAULT_MEDIA_RECEIVER_APP_ID: string;
    enum StreamType {
      BUFFERED = "BUFFERED",
    }
    enum HlsSegmentFormat {
      FMP4 = "fmp4",
    }
    enum HlsVideoSegmentFormat {
      FMP4 = "fmp4",
    }
    class GenericMediaMetadata {
      title?: string;
      subtitle?: string;
      images?: Image[];
    }
    class MediaInfo {
      constructor(contentId: string, contentType: string);
      contentId: string;
      contentUrl?: string;
      streamType: StreamType;
      metadata: GenericMediaMetadata;
      duration?: number;
      hlsSegmentFormat?: HlsSegmentFormat;
      hlsVideoSegmentFormat?: HlsVideoSegmentFormat;
    }
    class LoadRequest {
      constructor(media: MediaInfo);
      autoplay: boolean;
      currentTime: number;
    }
    interface Media {
      mediaSessionId: number;
      idleReason: "CANCELLED" | "INTERRUPTED" | "FINISHED" | "ERROR" | null;
      playerState: "IDLE" | "PLAYING" | "PAUSED" | "BUFFERING";
      media: MediaInfo | null;
      addUpdateListener(listener: (alive: boolean) => void): void;
      removeUpdateListener(listener: (alive: boolean) => void): void;
    }
  }
}

declare namespace cast.framework {
  enum CastState {
    NO_DEVICES_AVAILABLE = "NO_DEVICES_AVAILABLE",
    NOT_CONNECTED = "NOT_CONNECTED",
    CONNECTING = "CONNECTING",
    CONNECTED = "CONNECTED",
  }
  enum SessionState {
    SESSION_STARTED = "SESSION_STARTED",
    SESSION_RESUMED = "SESSION_RESUMED",
    SESSION_ENDED = "SESSION_ENDED",
  }
  enum CastContextEventType {
    CAST_STATE_CHANGED = "caststatechanged",
    SESSION_STATE_CHANGED = "sessionstatechanged",
  }
  enum RemotePlayerEventType {
    ANY_CHANGE = "anyChanged",
  }
  interface CastSession {
    getCastDevice(): { friendlyName: string };
    getMediaSession(): chrome.cast.media.Media | null;
    loadMedia(request: chrome.cast.media.LoadRequest): Promise<string | undefined>;
    sendMessage(namespace: string, message: object): Promise<string | undefined>;
  }
  class CastContext {
    static getInstance(): CastContext;
    setOptions(options: { receiverApplicationId: string; autoJoinPolicy: chrome.cast.AutoJoinPolicy }): void;
    getCastState(): CastState;
    getCurrentSession(): CastSession | null;
    requestSession(): Promise<string | undefined>;
    endCurrentSession(stopCasting: boolean): void;
    addEventListener(type: CastContextEventType.CAST_STATE_CHANGED, handler: (e: { castState: CastState }) => void): void;
    addEventListener(type: CastContextEventType.SESSION_STATE_CHANGED, handler: (e: { sessionState: SessionState }) => void): void;
  }
  class RemotePlayer {
    isConnected: boolean;
    isMediaLoaded: boolean;
    isPaused: boolean;
    currentTime: number;
    duration: number;
    volumeLevel: number;
    playerState: "IDLE" | "PLAYING" | "PAUSED" | "BUFFERING" | null;
  }
  class RemotePlayerController {
    constructor(player: RemotePlayer);
    addEventListener(type: RemotePlayerEventType, handler: (e: { field: string; value: unknown }) => void): void;
    playOrPause(): void;
    seek(): void;
    setVolumeLevel(): void;
    stop(): void;
  }
}

interface Window {
  __onGCastApiAvailable?: (available: boolean) => void;
  chrome?: unknown;
}
