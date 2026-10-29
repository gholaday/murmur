import { describe, expect, it } from "vitest";
import { audioCodecString, probedVideo, videoCodecString } from "./codecs";

describe("codecs", () => {
  it("builds RFC 6381 strings", () => {
    expect(videoCodecString({ index: 0, codec_name: "h264", profile: "High", level: 41 })).toBe("avc1.640029");
    expect(videoCodecString({ index: 0, codec_name: "hevc", profile: "Main 10", level: 153, pix_fmt: "yuv420p10le" })).toBe(
      "hvc1.2.4.L153.B0",
    );
    expect(audioCodecString({ index: 1, codec_name: "aac", profile: "LC" })).toBe("mp4a.40.2");
    expect(audioCodecString({ index: 1, codec_name: "eac3" })).toBe("ec-3");
    expect(audioCodecString({ index: 1, codec_name: "dts" })).toBe("dts");
  });

  it("skips cover art and numbers tracks within their kind", () => {
    const v = probedVideo({
      format: { format_name: "matroska,webm", duration: "100.5" },
      streams: [
        { index: 0, codec_type: "video", codec_name: "mjpeg", disposition: { attached_pic: 1 } },
        { index: 1, codec_type: "video", codec_name: "h264", profile: "Main", level: 30, width: 1280, height: 720, color_transfer: "bt709" },
        { index: 2, codec_type: "audio", codec_name: "ac3", channels: 6, tags: { language: "eng" }, disposition: { default: 1 } },
        { index: 3, codec_type: "subtitle", codec_name: "subrip", tags: { language: "und" } },
      ],
    });
    expect(v).toMatchObject({ container: "matroska,webm", durationSec: 100.5, videoCodec: "avc1.4D401E", width: 1280, hdr: null });
    expect(v.audioTracks).toEqual([{ index: 0, codec: "ac-3", channels: 6, language: "eng", title: null, isDefault: true }]);
    expect(v.subtitleTracks[0]).toMatchObject({ index: 0, codec: "subrip", language: null });
  });
});
