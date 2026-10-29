import { execFile, spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { VideoSource, VideoStreamStarted } from "@murmur/shared";
import { canToneMap, encoder, type Encoder, giveUpOn, H264_CODEC, h264Args } from "./encoders";
import { env } from "./env";
import { HttpError } from "./http";
import { createLogger } from "./log";

// Streaming, like Plex's Direct Stream and Transcode: ffmpeg makes HLS pieces from wherever playback
// starts, with the picture copied or converted to H.264 and the sound copied or converted to AAC. A
// seek past what's been made starts a new session there. Only a window around what the player is
// asking for stays on disk, and nothing is kept once a session ends.

const log = createLogger("watch-stream");

const SEGMENT_SEC = 6;
/** After a burst to get going, ffmpeg runs this many times faster than real time and no faster. */
const READ_RATE = 3;
const INITIAL_BURST_SEC = 30;
/** A session nobody has asked anything of for this long is stopped and deleted. */
const IDLE_MS = 5 * 60_000;
const MAX_PER_OWNER = 2;
/** How long a request waits for a piece ffmpeg hasn't written yet before telling the player to ask again. */
const WAIT_MS = 20_000;
/** Pieces kept behind the newest one asked for (three minutes), so a short seek back is still instant. */
const KEEP_BEHIND = 30;
/** ffmpeg is paused once it's this many pieces (ten minutes) ahead of the player, and carries on below half. */
const MAX_AHEAD = 100;
/** Pausing a process needs SIGSTOP, which Windows doesn't have; there it simply runs on. */
const CAN_PAUSE = process.platform !== "win32";
const FILE_NAME = /^(index\.m3u8|init\.mp4|seg\d{5}\.m4s)$/;
const SEGMENT = /^seg(\d{5})\.m4s$/;

/** How long a GPU run has to write its first piece or stop; a run that stops in that time is a refusal. */
const FIRST_PIECE_MS = 15_000;
/** A GPU run that has written nothing after this long has hung, and the CPU takes over. */
const HUNG_MS = 60_000;

interface Session {
  id: string;
  owner: string;
  dir: string;
  /** The CODECS the pieces carry, for the master playlist; browsers guess wrong without it. */
  codecs: string;
  /** Null only for the moment between making the session and starting ffmpeg. */
  proc: ChildProcess | null;
  done: boolean;
  error: string | null;
  lastSeen: number;
  /** The newest piece the player has asked for, and the pieces below this have been deleted. */
  asked: number;
  deletedBelow: number;
  /** ffmpeg is stopped with SIGSTOP because it got too far ahead. */
  paused: boolean;
}

const root = () => path.join(env.cacheDir, "streams");
const sessions = new Map<string, Session>();

/** Clears folders left from before a restart, and starts the idle and tidy timers. Run once at start. */
export function initStreams() {
  // A folder that won't go (a file still open in it) is left; nothing else depends on it.
  try {
    fs.rmSync(root(), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (err) {
    log.warn("old stream folders not removed", { error: err instanceof Error ? err.message : String(err) });
  }
  setInterval(() => {
    for (const s of sessions.values()) if (Date.now() - s.lastSeen > IDLE_MS) stop(s);
  }, 60_000).unref();
  setInterval(() => {
    for (const s of sessions.values()) tidy(s);
  }, 3_000).unref();
}

/** Stops every ffmpeg, which would outlive the add-on otherwise (on Windows above all). */
export function stopAllStreams() {
  for (const s of sessions.values()) if (!s.done) kill(s);
}

export const streamCount = () => sessions.size;

/** Stops ffmpeg, waking it first if it was paused, since a stopped process doesn't act on SIGTERM. */
function kill(s: Session) {
  const proc = s.proc;
  if (!proc) return;
  if (s.paused) {
    s.paused = false;
    proc.kill("SIGCONT");
  }
  proc.kill();
}

function stop(s: Session) {
  sessions.delete(s.id);
  if (!s.done) kill(s);
  // Windows keeps the files locked a moment after ffmpeg is told to stop.
  fs.rm(s.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }, () => undefined);
}

/**
 * Keeps a session's folder to a window around the player: pieces well behind what it last asked for
 * are deleted, and ffmpeg is paused while it's far ahead (it runs faster than real time, so a copied
 * 4K film would otherwise land on disk whole within a third of its length).
 */
function tidy(s: Session) {
  let names: string[];
  try {
    names = fs.readdirSync(s.dir);
  } catch {
    return;
  }
  let newest = -1;
  for (const name of names) {
    const m = SEGMENT.exec(name);
    if (!m) continue;
    const n = Number(m[1]);
    newest = Math.max(newest, n);
    if (n < s.asked - KEEP_BEHIND) fs.rm(path.join(s.dir, name), { force: true }, () => undefined);
  }
  s.deletedBelow = Math.max(s.deletedBelow, s.asked - KEEP_BEHIND);
  if (!CAN_PAUSE || s.done || !s.proc) return;
  const ahead = newest - s.asked;
  if (!s.paused && ahead > MAX_AHEAD) {
    s.paused = s.proc.kill("SIGSTOP");
  } else if (s.paused && ahead < MAX_AHEAD / 2) {
    s.paused = false;
    s.proc.kill("SIGCONT");
  }
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
export async function startStream(owner: string, src: VideoSource, at: number): Promise<VideoStreamStarted> {
  // A copied picture can only start on a keyframe; a converted one starts exactly where asked.
  const converting = src.video === "h264";
  const start = converting ? at : await keyframeAt(src.file, at);
  const id = crypto.randomBytes(12).toString("base64url");
  const dir = path.join(root(), id);
  fs.mkdirSync(dir, { recursive: true });
  // Only once this one can start do the person's oldest sessions make room for it.
  const mine = [...sessions.values()].filter((s) => s.owner === owner).sort((a, b) => a.lastSeen - b.lastSeen);
  for (const s of mine.slice(0, Math.max(0, mine.length - MAX_PER_OWNER + 1))) stop(s);
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

  const session: Session = {
    id,
    owner,
    dir,
    codecs,
    proc: null,
    done: false,
    error: null,
    lastSeen: Date.now(),
    asked: 0,
    deletedBelow: 0,
    paused: false,
  };
  sessions.set(id, session);
  const run = (args: string[]) => {
    const proc = spawn(env.ffmpegPath, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    session.proc = proc;
    session.done = false;
    session.error = null;
    session.paused = false;
    let errors = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      errors = (errors + chunk.toString()).slice(-2000);
    });
    // A run that was replaced (the CPU took over) no longer speaks for the session.
    proc.on("error", (err) => {
      if (session.proc !== proc) return;
      session.done = true;
      session.error = err.message;
    });
    proc.on("close", (code, signal) => {
      if (session.proc !== proc) return;
      session.done = true;
      if (code !== 0 && !signal && sessions.has(id)) {
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
  // One that's only slow (an HDR film tone mapped on the CPU first) keeps going.
  const onCpu = async () => {
    // The old run is stopped and its handlers stand down before its folder is replaced.
    const old = session.proc;
    session.proc = null;
    old?.kill();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.mkdirSync(dir, { recursive: true });
    run(await argsWith("cpu"));
    log.info("stream restarted on the CPU", { video: src.videoId });
  };
  if (enc !== "cpu") {
    const first = await firstPiece(session, FIRST_PIECE_MS);
    if (first === "stopped") {
      giveUpOn(enc);
      await onCpu();
    } else if (first === "slow") {
      // Still nothing after a minute: the GPU has hung on this file rather than refused it, so the CPU
      // takes over for this stream only.
      const gpuRun = session.proc;
      void firstPiece(session, HUNG_MS - FIRST_PIECE_MS).then(async (later) => {
        if (later !== "ok" && sessions.has(id) && session.proc === gpuRun) await onCpu().catch(() => undefined);
      });
    }
  }
  return { sessionId: id, start };
}

/** "ok" once the first piece exists, "stopped" if ffmpeg exited first, "slow" if neither happened within `ms`. */
async function firstPiece(s: Session, ms: number): Promise<"ok" | "stopped" | "slow"> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (fs.existsSync(path.join(s.dir, "seg00000.m4s"))) return "ok";
    if (s.done) return "stopped";
    await new Promise((r) => setTimeout(r, 100));
  }
  return "slow";
}

function sessionFor(owner: string, id: string): Session {
  const s = sessions.get(id);
  // Someone else's session looks the same as an ended one.
  if (!s || s.owner !== owner) throw new HttpError(404, "This stream has ended.");
  s.lastSeen = Date.now();
  return s;
}

export function endStream(owner: string, id: string) {
  const s = sessions.get(id);
  if (s && s.owner === owner) stop(s);
}

/** The playlist the player opens: one variant, naming the codecs so the browser knows what it's getting. */
export function masterPlaylist(owner: string, id: string): string {
  const s = sessionFor(owner, id);
  // The bandwidth is a rough stand-in; there's only one variant to choose from.
  return `#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-STREAM-INF:BANDWIDTH=20000000,CODECS="${s.codecs}"\nindex.m3u8\n`;
}

/**
 * A playlist or piece of a session, waiting briefly for ffmpeg to write it. A piece that's still
 * being made gets a 503 to ask again, so a slow server doesn't make the player start over; one
 * that's gone (deleted behind the player, or never coming) gets a 404, and the player starts a new
 * session there.
 */
export async function streamFilePath(owner: string, id: string, name: string): Promise<string> {
  if (!FILE_NAME.test(name)) throw new HttpError(404, "Not found.");
  const s = sessionFor(owner, id);
  const piece = SEGMENT.exec(name);
  const n = piece ? Number(piece[1]) : -1;
  if (piece) {
    if (n < s.deletedBelow) throw new HttpError(404, "That part of the stream has been cleared.");
    // A paused ffmpeg carries on as soon as the player catches up, not at the next tidy.
    if (n > s.asked && s.paused && s.proc) {
      s.paused = false;
      s.proc.kill("SIGCONT");
    }
  }
  const file = path.join(s.dir, name);
  const until = Date.now() + WAIT_MS;
  while (!fs.existsSync(file)) {
    if (s.error) throw new HttpError(500, `The stream stopped: ${s.error}`);
    if (s.done) throw new HttpError(404, "That part of the stream isn't there.");
    if (Date.now() > until) throw new HttpError(503, "That part of the stream is still being made.", { "Retry-After": "2" });
    await new Promise((r) => setTimeout(r, 150));
  }
  // Only a piece that's there moves the window: asking far ahead mustn't clear what's been made.
  if (n > s.asked) s.asked = n;
  return file;
}

export const streamMimeType = (name: string) =>
  name.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : name.endsWith(".m4s") ? "video/iso.segment" : "video/mp4";
