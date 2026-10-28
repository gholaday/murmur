import { describe, expect, it } from "vitest";
import { playbackPlan, type PlaybackSupport, type VideoAudioTrack, type VideoFileInfo } from "@murmur/shared";

const aac = (index: number, isDefault = index === 0): VideoAudioTrack => ({ index, codec: "mp4a.40.2", channels: 2, language: "eng", title: null, isDefault });
const ac3 = (index: number, isDefault = index === 0): VideoAudioTrack => ({ index, codec: "ac-3", channels: 6, language: "eng", title: null, isDefault });

const file = (over: Partial<VideoFileInfo>): VideoFileInfo => ({
  container: "matroska,webm",
  videoCodec: "avc1.640028",
  width: 1920,
  height: 1080,
  hdr: null,
  audioTracks: [aac(0)],
  subtitleTracks: [],
  size: 1,
  fileName: "a.mkv",
  ...over,
});

/** A Chrome-like browser: H.264 and AAC, no HEVC, no Dolby, MKV unsure. */
const chrome: PlaybackSupport = {
  video: (c) => c.startsWith("avc1"),
  audio: (c) => c.startsWith("mp4a"),
  container: (c) => (c.startsWith("mov") ? true : c === "avi" ? false : null),
};

describe("playbackPlan", () => {
  it("plays what the browser reads as it is", () => {
    expect(playbackPlan(file({}), chrome)).toEqual({ kind: "direct" });
  });

  it("converts the picture when the browser can't play it, and the sound only if needed", () => {
    expect(playbackPlan(file({ videoCodec: "hvc1.2.4.L150.B0" }), chrome)).toEqual({ kind: "transcode", track: 0, audio: "copy" });
    expect(playbackPlan(file({ videoCodec: "hvc1.2.4.L150.B0", audioTracks: [ac3(0)] }), chrome)).toEqual({ kind: "transcode", track: 0, audio: "aac" });
  });

  it("streams remuxed a container the browser can't open, copying sound that plays", () => {
    expect(playbackPlan(file({ container: "avi" }), chrome)).toEqual({ kind: "remux", track: 0, audio: "copy" });
  });

  it("converts sound the browser can't play", () => {
    expect(playbackPlan(file({ audioTracks: [ac3(0)] }), chrome)).toEqual({ kind: "remux", track: 0, audio: "aac" });
  });

  it("streams another track remuxed, since browsers can't switch them", () => {
    expect(playbackPlan(file({ audioTracks: [aac(0), aac(1)] }), chrome, { track: 1 })).toEqual({ kind: "remux", track: 1, audio: "copy" });
    expect(playbackPlan(file({ audioTracks: [aac(0, false), aac(1, true)] }), chrome)).toEqual({ kind: "direct" });
  });

  it("streams remuxed a file that wouldn't open when tried", () => {
    expect(playbackPlan(file({}), chrome, { forceRemux: true })).toEqual({ kind: "remux", track: 0, audio: "copy" });
  });
});
