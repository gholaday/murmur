import { execFile, spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RemuxAudio, StreamVideo, VideoFileInfo, VideoQuality } from "@murmur/shared";
import { env } from "../env";
import { HttpError } from "../http";
import { createLogger } from "../log";
import { canToneMap, encoder, type Encoder, giveUpOn, H264_CODEC, h264Args } from "./encoders";

// Remuxed streaming, like Plex's Direct Stream: ffmpeg copies the picture into HLS pieces as they're
// watched, with the sound copied or converted, from wherever playback starts. A seek past what's been
// made starts a new session there. Nothing is kept once a session ends.

const log = createLogger("watch-stream");

const SEGMENT_SEC = 6;
/** After a burst to get going, ffmpeg runs this many times faster than real time and no faster. */
const READ_RATE = 3;
const INITIAL_BURST_SEC = 30;
/** A session nobody has asked anything of for this long is stopped and deleted. */
const IDLE_MS = 5 * 60_000;
const MAX_PER_USER = 2;
/** How long a request waits for a piece ffmpeg hasn't written yet. */
const WAIT_MS = 20_000;
const FILE_NAME = /^(index\.m3u8|init\.mp4|seg\d{5}\.m4s)$/;

export interface StreamSource {
  videoId: string;
  file: string;
  /** RFC 6381, as the file has it. */
  videoCodec: string | null;
  width: number | null;
  height: number | null;
  hdr: VideoFileInfo["hdr"];
  /** The chosen track's RFC 6381 codec, or null when the file has no audio. */
  audioCodec: string | null;
  track: number;
  audio: RemuxAudio;
  video: StreamVideo;
  quality: VideoQuality;
}

/** How long to wait for a converted stream's first piece before deciding the encoder doesn't work on this file. */
const FIRST_PIECE_MS = 15_000;

interface Session {
  id: string;
  userId: number;
  dir: string;
  /** The CODECS the pieces carry, for the master playlist; browsers guess wrong without it. */
  codecs: string;
  /** Null only for the moment between making the session and starting ffmpeg. */
  proc: ChildProcess | null;
  done: boolean;
  error: string | null;
  lastSeen: number;
}

interface Holder {
  sessions: Map<string, Session>;
}

// Started by one request and read by others, which Next may give separate copies of this module.
declare global {
  var __murmurStreams: Holder | undefined;
}

const root = () => path.join(env.watchCacheDir, "streams");

function holder(): Holder {
  if (!globalThis.__murmurStreams) {
    const h: Holder = { sessions: new Map() };
    globalThis.__murmurStreams = h;
    // Folders from before a restart belong to no one now. A folder that won't go (a file still
    // open in it) is left; nothing else depends on it.
    try {
      fs.rmSync(root(), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch (err) {
      log.warn("old stream folders not removed", { error: err instanceof Error ? err.message : String(err) });
    }
    setInterval(() => {
      for (const s of h.sessions.values()) if (Date.now() - s.lastSeen > IDLE_MS) stop(s);
    }, 60_000).unref();
    // ffmpeg would outlive the server otherwise, on Windows above all.
    const stopAll = () => {
      for (const s of h.sessions.values()) if (!s.done) s.proc?.kill();
    };
    process.once("exit", stopAll);
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        stopAll();
        // Next shuts itself down on these; only when nothing else listens would the process stay up.
        if (process.listenerCount(signal) === 0) process.exit(0);
      });
    }
  }
  return globalThis.__murmurStreams;
}

function stop(s: Session) {
  holder().sessions.delete(s.id);
  if (!s.done) s.proc?.kill();
  // Windows keeps the files locked a moment after ffmpeg is told to stop.
  fs.rm(s.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }, () => undefined);
}

/** How far back to look for a keyframe; films keep them at most about ten seconds apart. */
const KEYFRAME_LOOKBACK_SEC = 30;

/**
 * The keyframe at or before `at`, where a copied picture can start (the one after it when there's
 * none before); `at` itself if that can't be read. The sound is kept from the same point, so the
 * two start together.
 */
function keyframeAt(file: string, at: number): Promise<number> {
  if (at <= 0) return Promise.resolve(0);
  const from = Math.max(0, at - KEYFRAME_LOOKBACK_SEC);
  return new Promise((resolve) => {
    execFile(
      env.ffprobePath,
      ["-v", "error", "-select_streams", "v:0", "-read_intervals", `${from.toFixed(3)}%${(at + 1).toFixed(3)}`, "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", file],
      { timeout: 15_000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(at);
        const keyframes = (stdout ?? "")
          .trim()
          .split("\n")
          .map((line) => line.split(","))
          .filter(([, flags]) => flags?.includes("K"))
          .map(([pts]) => Number(pts))
          .filter((t) => Number.isFinite(t))
          .sort((a, b) => a - b);
        const before = keyframes.filter((t) => t <= at + 0.05).at(-1);
        resolve(before ?? keyframes[0] ?? at);
      },
    );
  });
}

/** Starts streaming a video from `at` (snapped to a keyframe) and returns where it really starts. */
export async function startStream(userId: number, src: StreamSource, at: number): Promise<{ sessionId: string; start: number }> {
  const h = holder();
  const mine = [...h.sessions.values()].filter((s) => s.userId === userId).sort((a, b) => a.lastSeen - b.lastSeen);
  for (const s of mine.slice(0, Math.max(0, mine.length - MAX_PER_USER + 1))) stop(s);

  // A copied picture can only start on a keyframe; a converted one starts exactly where asked.
  const converting = src.video === "h264";
  const start = converting ? at : await keyframeAt(src.file, at);
  const id = crypto.randomBytes(12).toString("base64url");
  const dir = path.join(root(), id);
  fs.mkdirSync(dir, { recursive: true });
  const hevc = /^(hvc1|hev1)/.test(src.videoCodec ?? "");
  const codecs = [
    // The picture is tagged hvc1 below, so its codec string says the same.
    converting ? H264_CODEC : src.videoCodec?.replace(/^hev1/, "hvc1"),
    src.audio === "aac" ? "mp4a.40.2" : src.audioCodec,
  ]
    .filter(Boolean)
    .join(",");
  // ffmpeg's HLS muxer only knows "/" as a folder break: with Windows paths, init.mp4 lands in the working folder.
  const out = (name: string) => path.join(dir, name).replaceAll("\\", "/");
  const argsWith = async (enc: Encoder) => {
    const picture = { width: src.width, height: src.height, hdr: !!src.hdr };
    const h264 = converting ? h264Args(enc, picture, src.quality, await canToneMap(), SEGMENT_SEC) : null;
    return [
      ...["-v", "error", "-nostdin", "-readrate", String(READ_RATE), "-readrate_initial_burst", String(INITIAL_BURST_SEC)],
      ...(h264?.before ?? []),
      // A copied picture starts on the keyframe the seek lands on; without this ffmpeg would still
      // trim converted sound to the exact second, leaving it behind the picture.
      ...(converting ? [] : ["-noaccurate_seek"]),
      ...["-ss", start.toFixed(3), "-i", src.file],
      ...["-map", "0:v:0", "-map", `0:a:${src.track}?`],
      ...(h264?.after ?? ["-c:v", "copy"]),
      // Safari only plays HEVC tagged hvc1; unofficial keeps Dolby Vision's details.
      ...(hevc && !converting ? ["-tag:v", "hvc1", "-strict", "unofficial"] : []),
      ...(src.audio === "copy" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k", "-ac", "2"]),
      ...["-sn", "-dn", "-max_muxing_queue_size", "1024"],
      ...["-f", "hls", "-hls_time", String(SEGMENT_SEC), "-hls_playlist_type", "event", "-hls_segment_type", "fmp4"],
      ...["-hls_fmp4_init_filename", "init.mp4", "-hls_segment_filename", out("seg%05d.m4s")],
      ...["-hls_flags", "independent_segments+temp_file", out("index.m3u8")],
    ];
  };

  const session: Session = { id, userId, dir, codecs, proc: null, done: false, error: null, lastSeen: Date.now() };
  h.sessions.set(id, session);
  const run = (args: string[]) => {
    const proc = spawn(env.ffmpegPath, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    session.proc = proc;
    session.done = false;
    session.error = null;
    let errors = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      errors = (errors + chunk.toString()).slice(-2000);
    });
    proc.on("error", (err) => {
      session.done = true;
      session.error = err.message;
    });
    proc.on("close", (code, signal) => {
      session.done = true;
      if (code !== 0 && !signal && h.sessions.has(id)) {
        session.error = errors.trim().split("\n").at(-1) || `ffmpeg stopped (${code})`;
        log.warn("stream failed", { video: src.videoId, error: session.error });
      }
    });
  };

  const enc = converting ? await encoder() : "cpu";
  run(await argsWith(enc));
  log.info("stream started", { video: src.videoId, start, track: src.track, audio: src.audio, picture: src.video, encoder: enc });
  // A GPU encoder that passed its probe can still refuse a particular file (a codec or size the
  // driver can't take); if it stops before the first piece, the CPU takes over from the same spot.
  if (enc !== "cpu" && !(await firstPiece(session))) {
    giveUpOn(enc);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    run(await argsWith("cpu"));
    log.info("stream restarted on the CPU", { video: src.videoId });
  }
  return { sessionId: id, start };
}

/** True once the first piece exists; false if ffmpeg stopped first, or nothing came in time. */
async function firstPiece(s: Session): Promise<boolean> {
  const until = Date.now() + FIRST_PIECE_MS;
  while (Date.now() < until) {
    if (fs.existsSync(path.join(s.dir, "seg00000.m4s"))) return true;
    if (s.done) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function sessionFor(userId: number, id: string): Session {
  const s = holder().sessions.get(id);
  // Someone else's session looks the same as an ended one.
  if (!s || s.userId !== userId) throw new HttpError(404, "This stream has ended.");
  s.lastSeen = Date.now();
  return s;
}

export function endStream(userId: number, id: string) {
  const s = holder().sessions.get(id);
  if (s && s.userId === userId) stop(s);
}

/** The playlist the player opens: one variant, naming the codecs so the browser knows what it's getting. */
export function masterPlaylist(userId: number, id: string): string {
  const s = sessionFor(userId, id);
  // The bandwidth is a rough stand-in; there's only one variant to choose from.
  return `#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-STREAM-INF:BANDWIDTH=20000000,CODECS="${s.codecs}"\nindex.m3u8\n`;
}

/** A playlist or piece of a session, waiting briefly for ffmpeg to write it. */
export async function streamFilePath(userId: number, id: string, name: string): Promise<string> {
  if (!FILE_NAME.test(name)) throw new HttpError(404, "Not found.");
  const s = sessionFor(userId, id);
  const file = path.join(s.dir, name);
  const until = Date.now() + WAIT_MS;
  while (!fs.existsSync(file)) {
    if (s.error) throw new HttpError(500, `The stream stopped: ${s.error}`);
    if (s.done || Date.now() > until) throw new HttpError(404, "That part of the stream isn't there.");
    await new Promise((r) => setTimeout(r, 150));
  }
  return file;
}

export const streamMimeType = (name: string) =>
  name.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : name.endsWith(".m4s") ? "video/iso.segment" : "video/mp4";
