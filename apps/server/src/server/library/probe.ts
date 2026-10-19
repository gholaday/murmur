import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProbeResult } from "./parse";

const run = promisify(execFile);

interface FfprobeJson {
  format?: { duration?: string; tags?: Record<string, string> };
  streams?: Array<{ codec_type?: string; tags?: Record<string, string>; disposition?: { attached_pic?: number } }>;
  chapters?: Array<{ start_time?: string; end_time?: string; tags?: Record<string, string> }>;
}

function lowerKeys(tags: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags ?? {})) out[k.toLowerCase()] = v;
  return out;
}

/** Reads duration, tags and chapters with ffprobe. Times out rather than hang on a damaged file. */
export async function probeFile(ffprobePath: string, file: string): Promise<ProbeResult> {
  const { stdout } = await run(
    ffprobePath,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters", file],
    { timeout: 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
  );
  const json = JSON.parse(stdout) as FfprobeJson;
  const audio = json.streams?.find((s) => s.codec_type === "audio");
  const tags = { ...lowerKeys(audio?.tags), ...lowerKeys(json.format?.tags) };
  const durationSec = Number(json.format?.duration ?? 0);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("ffprobe reported no duration");
  }
  return {
    durationSec,
    tags,
    chapters: (json.chapters ?? [])
      .map((c) => ({
        startSec: Number(c.start_time ?? 0),
        endSec: Number(c.end_time ?? 0),
        title: c.tags?.title ?? c.tags?.TITLE ?? null,
      }))
      .filter((c) => Number.isFinite(c.startSec) && c.endSec > c.startSec),
    hasEmbeddedCover: (json.streams ?? []).some(
      (s) => s.codec_type === "video" && s.disposition?.attached_pic === 1,
    ),
  };
}

/** Extracts the embedded cover image of an audio file as JPEG bytes. */
export async function extractEmbeddedCover(ffmpegPath: string, file: string): Promise<Buffer | null> {
  try {
    const { stdout } = await run(
      ffmpegPath,
      ["-v", "error", "-i", file, "-map", "0:v:0", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
      { timeout: 60_000, maxBuffer: 32 * 1024 * 1024, encoding: "buffer", windowsHide: true },
    );
    return stdout.length > 0 ? stdout : null;
  } catch {
    return null;
  }
}

/** Runs async tasks with at most `limit` in flight, so a large import can't swamp the NAS. */
export function createLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= limit) return;
    const start = queue.shift();
    if (start) start();
  };
  return function limited<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}
