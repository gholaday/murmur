import { execFile } from "node:child_process";
import type { VideoAddonHealth, VideoQuality } from "@murmur/shared";
import { env } from "./env";
import { TONEMAP } from "./ffmpeg";
import { createLogger } from "./log";

// How a stream's picture gets converted to H.264: on a GPU where the server has one that works,
// else on the CPU. Each encoder is tried once with a tiny test encode, in order of preference, and
// the first that runs is used from then on. WATCH_HW picks one, or turns them off.

const log = createLogger("watch-encoders");

export type Encoder = VideoAddonHealth["encoder"];
export const ENCODERS: readonly Encoder[] = ["nvenc", "qsv", "vaapi", "amf", "videotoolbox", "cpu"];

/** Converted pictures are H.264 High 4.2: 1080p at up to 60 frames, which everything plays. */
export const H264_CODEC = "avc1.64002A";

/** What a quality setting means: the height cap and roughly how hard the encoder works. */
const QUALITY = {
  full: { maxHeight: 1080, qp: 22, crf: 22, preset: "veryfast" },
  light: { maxHeight: 720, qp: 26, crf: 26, preset: "ultrafast" },
} satisfies Record<VideoQuality, { maxHeight: number; qp: number; crf: number; preset: string }>;

export interface Picture {
  width: number | null;
  height: number | null;
  hdr: boolean;
}

/** Device options that go before `-i` for hardware decoding, so the GPU reads the file too. */
function decodeArgs(encoder: Encoder, hdr: boolean): string[] {
  // HDR is tone mapped on the CPU (the GPU filters for it are patchy), so those frames are decoded there as well.
  if (hdr) return [];
  switch (encoder) {
    case "vaapi":
      return ["-vaapi_device", env.vaapiDevice, "-hwaccel", "vaapi", "-hwaccel_output_format", "vaapi"];
    case "qsv":
      return ["-hwaccel", "qsv", "-hwaccel_output_format", "qsv"];
    case "nvenc":
      return ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"];
    case "videotoolbox":
      return ["-hwaccel", "videotoolbox"];
    default:
      return [];
  }
}

/** The output size under the cap, both sides even, or null when the picture already fits (or its size isn't known). */
function fit(p: Picture, maxHeight: number): { w: number; h: number } | null {
  if (!p.width || !p.height || p.height <= maxHeight) return null;
  const w = Math.round((p.width * maxHeight) / p.height / 2) * 2;
  return { w, h: maxHeight };
}

/**
 * The filter chain: tone map and scale on the CPU, or hand the frames to the GPU and scale there.
 * `format=X|gpu,hwupload` takes frames the GPU decoded as they are and uploads the rest, so a file
 * the GPU can't decode (ffmpeg then decodes it on the CPU) still encodes on it.
 */
function filterArgs(encoder: Encoder, p: Picture, maxHeight: number, canToneMap: boolean): string[] {
  const size = fit(p, maxHeight);
  const soft: string[] = [];
  if (size) soft.push(`scale=${size.w}:${size.h}`);
  if (p.hdr && canToneMap) soft.push(TONEMAP);
  // The GPU scaler also turns 10-bit frames (HEVC rips, mostly) into the 8-bit nv12 the H.264 encoders take.
  const gpuScale = size ? `w=${size.w}:h=${size.h}:format=nv12` : "format=nv12";
  switch (encoder) {
    case "vaapi":
      if (p.hdr) return ["-vf", [...soft, "format=nv12", "hwupload"].join(",")];
      return ["-vf", ["format=nv12|p010|vaapi", "hwupload", `scale_vaapi=${gpuScale}`].join(",")];
    case "qsv":
      if (p.hdr) return ["-vf", [...soft, "format=nv12", "hwupload=extra_hw_frames=64"].join(",")];
      return ["-vf", ["format=nv12|p010|qsv", "hwupload=extra_hw_frames=64", `scale_qsv=${gpuScale}`].join(",")];
    case "nvenc":
      if (p.hdr) return ["-vf", [...soft, "format=nv12", "hwupload_cuda"].join(",")];
      // Re-uploading frames already on the GPU fails here, so the decoder must be NVDEC; a file it
      // can't decode fails fast and the stream restarts on the CPU.
      return ["-vf", `scale_cuda=${gpuScale}`];
    default:
      return ["-vf", [...soft, "format=yuv420p"].join(",")];
  }
}

function codecArgs(encoder: Encoder, quality: VideoQuality): string[] {
  const q = QUALITY[quality];
  switch (encoder) {
    case "nvenc":
      return ["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", String(q.qp), "-b:v", "0", "-profile:v", "high", "-level", "4.2"];
    case "qsv":
      return ["-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", String(q.qp), "-profile:v", "high", "-level", "42"];
    case "vaapi":
      return ["-c:v", "h264_vaapi", "-rc_mode", "CQP", "-qp", String(q.qp), "-profile:v", "high", "-level", "42"];
    case "amf":
      return ["-c:v", "h264_amf", "-quality", "speed", "-rc", "cqp", "-qp_i", String(q.qp), "-qp_p", String(q.qp), "-profile:v", "high", "-level", "4.2"];
    case "videotoolbox":
      return ["-c:v", "h264_videotoolbox", "-q:v", String(100 - q.qp * 2), "-profile:v", "high", "-level", "4.2"];
    default:
      return ["-c:v", "libx264", "-preset", q.preset, "-crf", String(q.crf), "-profile:v", "high", "-level", "4.2"];
  }
}

/** The arguments that convert the picture: those before `-i`, and those after the maps. */
export function h264Args(
  encoder: Encoder,
  p: Picture,
  quality: VideoQuality,
  canToneMap: boolean,
  segmentSec: number,
): { before: string[]; after: string[] } {
  return {
    before: decodeArgs(encoder, p.hdr),
    after: [
      ...codecArgs(encoder, quality),
      ...filterArgs(encoder, p, QUALITY[quality].maxHeight, canToneMap),
      // Keyframes on the piece boundaries, so each piece stands on its own.
      ...["-force_key_frames", `expr:gte(t,n_forced*${segmentSec})`],
      ...(encoder === "cpu" ? ["-sc_threshold", "0"] : []),
    ],
  };
}

function ffmpeg(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(env.ffmpegPath, ["-v", "error", "-nostdin", ...args], { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.toString().trim().split("\n").at(-1) || err.message));
      else resolve(stdout.toString());
    });
  });
}

/** Probed once, on first use. */
let probed: { encoder: Promise<Encoder>; toneMap: Promise<boolean>; broken: Set<Encoder> } | null = null;

function state() {
  probed ??= { encoder: probe(), toneMap: probeToneMap(), broken: new Set() };
  return probed;
}

/** Whether this ffmpeg has the zimg filters the HDR tone map needs. */
async function probeToneMap(): Promise<boolean> {
  try {
    const out = await ffmpeg(["-hide_banner", "-filters"], 15_000);
    return /\bzscale\b/.test(out) && /\btonemap\b/.test(out);
  } catch {
    return false;
  }
}

/** A short test encode of a generated picture through the encoder: it either runs or it doesn't. */
async function works(encoder: Encoder): Promise<boolean> {
  // A generated picture isn't decoded on the GPU, so this goes the way an HDR file does: CPU frames uploaded to the encoder.
  const p: Picture = { width: 1920, height: 1080, hdr: true };
  const { after } = h264Args(encoder, p, "light", false, 2);
  try {
    await ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-frames:v", "10", ...after, "-f", "null", "-"], 30_000);
    return true;
  } catch (err) {
    log.debug("encoder not available", { encoder, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

async function probe(): Promise<Encoder> {
  const want = env.watchHardware;
  if (want === "off") return "cpu";
  const candidates = ENCODERS.filter((e) => e !== "cpu" && (want === "auto" || e === want));
  for (const e of candidates) {
    if (e === "videotoolbox" && process.platform !== "darwin") continue;
    if (e === "vaapi" && process.platform === "win32") continue;
    if (await works(e)) {
      log.info("hardware encoder", { encoder: e });
      return e;
    }
  }
  if (want !== "auto") log.warn("hardware encoder not available, using the CPU", { wanted: want });
  else log.info("no hardware encoder, using the CPU");
  return "cpu";
}

/** The encoder streams convert with: the GPU's where one works, else the CPU. */
export async function encoder(): Promise<Encoder> {
  const s = state();
  const e = await s.encoder;
  return s.broken.has(e) ? "cpu" : e;
}

export const canToneMap = (): Promise<boolean> => state().toneMap;

/** A hardware encoder that passed the probe but failed on a real file is not used again; the CPU takes over. */
export function giveUpOn(e: Encoder) {
  if (e === "cpu") return;
  log.warn("hardware encoder failed on a file, using the CPU from now on", { encoder: e });
  state().broken.add(e);
}
