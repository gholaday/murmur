import { execFile } from "node:child_process";
import sharp from "sharp";
import { env } from "../env";
import { probedVideo, type FfprobeOutput, type ProbedVideo } from "./codecs";

// ffprobe and ffmpeg, run as child processes. Watch is the only part of Murmur that needs them,
// so when they're missing only Watch stops: the scan reports it and everything else carries on.

function run(cmd: string, args: string[], opts: { timeoutMs: number; binary?: boolean }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: "buffer", windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const detail = stderr.toString().trim().split("\n").at(-1);
          reject(new Error(detail || err.message));
        } else resolve(stdout);
      },
    );
  });
}

let available: Promise<boolean> | null = null;

/** Whether ffprobe and ffmpeg run. Checked once, then remembered. */
export function ffmpegAvailable(): Promise<boolean> {
  available ??= Promise.all([
    run(env.ffprobePath, ["-version"], { timeoutMs: 10_000 }),
    run(env.ffmpegPath, ["-version"], { timeoutMs: 10_000 }),
  ]).then(
    () => true,
    () => {
      available = null; // try again next scan, in case it was installed meanwhile
      return false;
    },
  );
  return available;
}

/** Length, codecs, resolution and tracks of a video file. */
export async function probeVideo(file: string): Promise<ProbedVideo> {
  const out = await run(env.ffprobePath, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], {
    timeoutMs: 60_000,
  });
  return probedVideo(JSON.parse(out.toString("utf8")) as FfprobeOutput);
}

/** HDR frames look grey and flat as they are; this maps them down to ordinary colour (needs zimg). */
export const TONEMAP = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";

/**
 * One frame as a JPEG, 960 pixels wide. Seeking before the input keeps it fast on big files.
 * HDR frames are tone mapped, or grabbed as they are if this ffmpeg can't.
 */
export async function grabFrame(file: string, atSec: number, hdr = false): Promise<Buffer> {
  const grab = (filter: string) =>
    run(
      env.ffmpegPath,
      ["-v", "error", "-ss", atSec.toFixed(1), "-i", file, "-frames:v", "1", "-vf", filter, "-f", "image2", "-c:v", "mjpeg", "pipe:1"],
      { timeoutMs: 60_000 },
    );
  if (hdr) {
    const mapped = await grab(`${TONEMAP},scale=960:-2`).catch(() => null);
    if (mapped?.length) return mapped;
  }
  return grab("scale=960:-2");
}

/** Where a film's still is looked for, as parts of its length; the first that's bright enough wins. */
const STILL_AT = [0.1, 0.25, 0.4];
/** Average brightness (0 to 255) that's good enough to stop looking; low enough to allow for black bars. */
const BRIGHT_ENOUGH = 50;

/**
 * A frame for the video's still: a tenth of the way in, unless that's a dark scene, in which case
 * a couple of later points are tried and the brightest kept. Black bars are left in; they're
 * trimmed when the picture is stored.
 */
export async function grabStill(file: string, durationSec: number, hdr: boolean): Promise<Buffer> {
  let best: { frame: Buffer; light: number } | null = null;
  for (const part of STILL_AT) {
    const frame = await grabFrame(file, Math.max(1, durationSec * part), hdr).catch((err: unknown) => {
      if (!best) throw err;
      return null;
    });
    if (!frame?.length) continue;
    const light = await brightness(frame);
    if (!best || light > best.light) best = { frame, light };
    if (light >= BRIGHT_ENOUGH) break;
  }
  return best?.frame ?? Buffer.alloc(0);
}

/** The frame's average brightness, from its greyscale mean. */
async function brightness(jpeg: Buffer): Promise<number> {
  const stats = await sharp(jpeg).greyscale().stats();
  return stats.channels[0]?.mean ?? 0;
}
