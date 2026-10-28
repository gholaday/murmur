import type { PlaybackSupport, VideoFileInfo } from "@murmur/shared/client";

// What this browser can play, for the playback rules in @murmur/shared (playbackProblem).
// MediaSource answers for codecs; containers are known per browser, since none of them says.

const WEBM_CODEC = /^(vp8|vp09|av01|opus|vorbis)/;

function canPlay(mime: string): boolean {
  if (typeof window === "undefined") return true;
  if (window.MediaSource?.isTypeSupported(mime)) return true;
  return document.createElement("video").canPlayType(mime) !== "";
}

/** Safari (not Chrome or Edge pretending): the one browser here that can't open MKV at all, and the one that plays HLS itself. */
export const isSafari = () => /safari/i.test(navigator.userAgent) && !/chrome|chromium|crios|edg|android/i.test(navigator.userAgent);

export function browserSupport(file: VideoFileInfo): PlaybackSupport {
  return {
    video: (codec) => canPlay(`video/mp4; codecs="${codec}"`) || (WEBM_CODEC.test(codec) && canPlay(`video/webm; codecs="${codec}"`)),
    audio: (codec) =>
      ["dts", "truehd", "mlpa"].includes(codec) || codec.startsWith("pcm_")
        ? false
        : canPlay(`audio/mp4; codecs="${codec}"`) || (WEBM_CODEC.test(codec) && canPlay(`audio/webm; codecs="${codec}"`)),
    container: (container) => {
      if (container.startsWith("mov,mp4")) return true;
      if (container === "avi" || container === "mpegts") return false;
      if (container.startsWith("matroska")) {
        const codecs = [file.videoCodec ?? "", ...file.audioTracks.map((t) => t.codec)];
        if (codecs.every((c) => !c || WEBM_CODEC.test(c))) return true; // really a WebM
        // Chrome, Edge and newer Firefox read MKV; Safari never does. Elsewhere, just try it.
        return isSafari() ? false : null;
      }
      return null;
    },
  };
}
