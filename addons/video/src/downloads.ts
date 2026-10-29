import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { apiPaths, gigabytes, type VideoDownloadDto, type VideoSource } from "@murmur/shared";
import { threadArgs } from "./cpu";
import { canToneMap, encoder, type Encoder, encoderFailed, h264Args } from "./encoders";
import { env } from "./env";
import { HttpError } from "./http";
import { createLogger, errorMessage } from "./log";

// Downloads for files the phone can't play as they are. ffmpeg makes an ordinary MP4 (its index at
// the front, so the phone can seek in it) into a file on the server, while the phone asks how far
// it's got; then the phone downloads it like any file, resuming if cut off. A pipe can't be used:
// an MP4 written front to back has no index Android's player can seek with.

const log = createLogger("watch-download");

/** Keyframes this far apart, as for streams, so seeking in the download is quick. */
const KEYFRAME_SEC = 6;
/** Converting the picture is the heavy part: one at a time per person, so a whole season doesn't swamp the server. */
const MAX_CONVERTING_PER_OWNER = 1;
/** A finished file is kept this long after it was last asked for, for the phone to fetch or resume. */
const KEEP_READY_MS = 6 * 3600_000;
/** A download nobody has asked about for this long was given up on; it's stopped and removed. */
const ABANDONED_MS = 10 * 60_000;
/**
 * Converted pictures are quality-based, so their size isn't known ahead: this is about the most a
 * film takes at each quality, in bits a second. A copied picture is about the size of the file.
 */
const MAX_BITRATE = { full: 10_000_000, light: 4_000_000 };
/** Left free beyond the download, for stream pieces and anything else on that disk. */
const SPARE_BYTES = 2 * 1024 ** 3;
/** Nobody is waiting on a download the way they wait on a stream, so its ffmpeg runs at a lower priority (Unix nice). */
const DOWNLOAD_NICE = 10;

interface Job {
  id: string;
  owner: string;
  /** The video and choices, so asking twice finds the same job. */
  key: string;
  file: string;
  status: VideoDownloadDto["status"];
  progress: number;
  error: string | null;
  converting: boolean;
  /** About how big the finished file will be, so other downloads leave room for it. */
  expectedBytes: number;
  proc: ChildProcess | null;
  lastSeen: number;
}

const root = () => path.join(env.cacheDir, "downloads");
const all = new Map<string, Job>();

/** Clears files left from before a restart, which belong to no job now, and starts the sweep. Run once at start. */
export function initDownloads() {
  try {
    fs.rmSync(root(), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (err) {
    log.warn("old download files not removed", { error: errorMessage(err) });
  }
  setInterval(() => {
    const now = Date.now();
    for (const j of all.values()) {
      const idle = now - j.lastSeen;
      if ((j.status === "preparing" && idle > ABANDONED_MS) || (j.status !== "preparing" && idle > KEEP_READY_MS)) remove(j);
    }
  }, 60_000).unref();
}

export function stopAllDownloads() {
  for (const j of all.values()) j.proc?.kill();
}

export const downloadCount = () => all.size;

function remove(j: Job) {
  all.delete(j.id);
  j.proc?.kill();
  j.proc = null;
  fs.rm(j.file, { force: true, maxRetries: 10, retryDelay: 300 }, () => undefined);
  fs.rm(`${j.file}.part.mp4`, { force: true, maxRetries: 10, retryDelay: 300 }, () => undefined);
}

const dto = (j: Job): VideoDownloadDto => ({
  id: j.id,
  status: j.status,
  progress: j.status === "ready" ? 1 : j.progress,
  size: j.status === "ready" ? (fs.statSync(j.file, { throwIfNoEntry: false })?.size ?? null) : null,
  error: j.error,
  fileUrl: apiPaths.videoDownloadFile(j.id),
});

function args(src: VideoSource, enc: Encoder, toneMap: boolean, out: string): string[] {
  const picture = { width: src.width, height: src.height, hdr: !!src.hdr };
  const h264 = src.video === "h264" ? h264Args(enc, picture, src.quality, toneMap, KEYFRAME_SEC) : null;
  const hevc = /^(hvc1|hev1)/.test(src.videoCodec ?? "");
  const threads = threadArgs();
  return [
    ...["-v", "error", "-nostdin", "-y", "-progress", "pipe:1", "-nostats"],
    ...threads.before,
    ...(h264?.before ?? []),
    ...["-i", src.file],
    ...["-map", "0:v:0", "-map", `0:a:${src.track}?`],
    ...(h264 ? [...h264.after, ...threads.after] : ["-c:v", "copy"]),
    // Players want HEVC in an MP4 tagged hvc1; unofficial keeps Dolby Vision's details.
    ...(hevc && !h264 ? ["-tag:v", "hvc1", "-strict", "unofficial"] : []),
    ...(src.audio === "copy" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k", "-ac", "2"]),
    // Chapters would come out as an extra data track the phone has no use for.
    ...["-sn", "-dn", "-map_chapters", "-1", "-max_muxing_queue_size", "1024"],
    // The index goes at the front once the rest is written, so the phone can seek as soon as it has it.
    ...["-movflags", "+faststart", "-f", "mp4", out],
  ];
}

/** Runs ffmpeg into the job's file; resolves true if it finished. */
function run(j: Job, src: VideoSource, enc: Encoder, toneMap: boolean): Promise<boolean> {
  const part = `${j.file}.part.mp4`;
  return new Promise((resolve) => {
    const proc = spawn(env.ffmpegPath, args(src, enc, toneMap, part), { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    j.proc = proc;
    // Streams come first: a season being prepared for a phone mustn't stall someone watching.
    if (proc.pid) {
      try {
        os.setPriority(proc.pid, DOWNLOAD_NICE);
      } catch {
        // Not allowed here; it runs at the usual priority.
      }
    }
    let errors = "";
    proc.stderr!.on("data", (chunk: Buffer) => {
      errors = (errors + chunk.toString()).slice(-2000);
    });
    // -progress writes key=value lines; out_time_us is how far into the video it has got.
    proc.stdout!.on("data", (chunk: Buffer) => {
      const m = /out_time_us=(\d+)\s*$/m.exec(chunk.toString());
      if (m && src.durationSec > 0) j.progress = Math.min(0.99, Number(m[1]) / 1e6 / src.durationSec);
    });
    proc.once("error", (err) => {
      j.error = err.message;
      resolve(false);
    });
    proc.once("close", (code, signal) => {
      if (j.proc === proc) j.proc = null;
      if (code === 0) {
        try {
          fs.renameSync(part, j.file);
          return resolve(true);
        } catch (err) {
          j.error = errorMessage(err);
          return resolve(false);
        }
      }
      if (!signal) j.error = errors.trim().split("\n").at(-1) || `ffmpeg stopped (${code})`;
      resolve(false);
    });
  });
}

async function prepare(j: Job, src: VideoSource) {
  const toneMap = await canToneMap();
  let enc: Encoder = j.converting ? await encoder() : "cpu";
  log.info("download preparing", { video: src.videoId, picture: src.video, audio: src.audio, encoder: enc });
  let ok = await run(j, src, enc, toneMap);
  // A GPU encoder that fails on this file hands it to the CPU, as for streams.
  if (!ok && enc !== "cpu" && all.has(j.id)) {
    log.warn("download failed on the GPU, trying the CPU", { video: src.videoId, encoder: enc, error: j.error });
    encoderFailed(enc, src.file);
    enc = "cpu";
    j.error = null;
    j.progress = 0;
    ok = await run(j, src, enc, toneMap);
  }
  if (!all.has(j.id)) return; // cancelled
  j.status = ok ? "ready" : "failed";
  if (ok) log.info("download ready", { video: src.videoId });
  else log.warn("download failed", { video: src.videoId, error: j.error });
}

/** About how big the download of this video will be. */
function expectedSize(src: VideoSource): number {
  if (src.video === "h264") return (src.durationSec * MAX_BITRATE[src.quality]) / 8;
  return fs.statSync(src.file, { throwIfNoEntry: false })?.size ?? 0;
}

/** Refuses a download the cache disk has no room for, counting what the ones being made still need. */
function checkSpace(expectedBytes: number) {
  const stat = fs.statfsSync(root());
  const free = stat.bavail * stat.bsize;
  const reserved = [...all.values()].filter((j) => j.status === "preparing").reduce((sum, j) => sum + j.expectedBytes * (1 - j.progress), 0);
  if (free - reserved < expectedBytes + SPARE_BYTES) {
    throw new HttpError(
      507,
      `Not enough space on the server for this download. It needs about ${gigabytes(expectedBytes)}, and ${gigabytes(Math.max(0, free - reserved))} is free.`,
    );
  }
}

/** Starts making the download, or reports on the one already being made for these choices. */
export function startDownload(owner: string, src: VideoSource): VideoDownloadDto {
  const key = [owner, src.videoId, src.track, src.audio, src.video, src.video === "h264" ? src.quality : ""].join("|");
  const existing = [...all.values()].find((j) => j.key === key && j.status !== "failed");
  if (existing) {
    existing.lastSeen = Date.now();
    return dto(existing);
  }
  const converting = src.video === "h264";
  const busy = [...all.values()].filter((j) => j.owner === owner && j.converting && j.status === "preparing").length;
  if (converting && busy >= MAX_CONVERTING_PER_OWNER) {
    throw new HttpError(429, "Another download is being converted. Try again once it's done.");
  }
  fs.mkdirSync(root(), { recursive: true });
  const expectedBytes = expectedSize(src);
  checkSpace(expectedBytes);
  const id = crypto.randomBytes(12).toString("base64url");
  const job: Job = {
    id,
    owner,
    key,
    file: path.join(root(), `${id}.mp4`),
    status: "preparing",
    progress: 0,
    error: null,
    converting,
    expectedBytes,
    proc: null,
    lastSeen: Date.now(),
  };
  all.set(id, job);
  void prepare(job, src).catch((err: unknown) => {
    job.status = "failed";
    job.error = errorMessage(err);
  });
  return dto(job);
}

/** A finished download's file, for the person it was made for. */
export function downloadFile(owner: string, id: string): string {
  const j = all.get(id);
  if (!j || j.owner !== owner) throw new HttpError(404, "This download has expired. Start it again.");
  j.lastSeen = Date.now();
  if (j.status !== "ready") throw new HttpError(409, "This download isn't ready yet.");
  return j.file;
}

/** Stops a download being made, or removes a finished one. */
export function cancelDownload(owner: string, id: string) {
  const j = all.get(id);
  if (j && j.owner === owner) remove(j);
}
