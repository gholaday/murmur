import { execFile } from "node:child_process";
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
