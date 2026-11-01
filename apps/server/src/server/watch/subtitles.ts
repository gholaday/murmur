import fs from "node:fs/promises";
import path from "node:path";
import { cuesToVtt, decodeSubtitle, parseCues, subtitleLanguage, TEXT_SUBTITLE_CODECS, type ProbedSubtitleTrack, type VideoSubtitleTrack } from "@murmur/shared";
import type { AppContext } from "../context";
import { env } from "../env";
import { HttpError, isHttpError } from "../http";
import { createLogger, errorMessage } from "../log";
import { resolveInside } from "../stream";
import type { SubtitleFile } from "./parse";
import { getVideoFile } from "./queries";
import { extractSubtitles } from "./video-addon";

// Every subtitle reaches a player as WebVTT from here. A file beside the video is read and
// converted on the spot, needing nothing else, so it works with the add-on down. A track inside a
// video needs the add-on and a read of the whole file, so that happens once, for every text track
// together, and the results are kept under the data folder until the file changes.

const log = createLogger("watch-subtitles");

export type StoredSubtitle = ProbedSubtitleTrack | SubtitleFile;

/** How long a failed read stands, so players asking again don't start one after another. */
const FAILED_MS = 60_000;
/** A short track is simply answered; only a slow one tells the player to ask again. */
const WAIT_MS = 1500;
const STILL_MAKING = () => new HttpError(503, "The subtitles are being read from the video.", { "Retry-After": "3" });

const isFile = (t: StoredSubtitle): t is SubtitleFile => "source" in t;

/** The tracks in `subtitle_tracks` a player can show, ready to send. */
export function shownSubtitles(stored: StoredSubtitle[]): VideoSubtitleTrack[] {
  return stored.flatMap((t) => {
    if (!isFile(t) && !TEXT_SUBTITLE_CODECS.includes(t.codec)) return [];
    const { index, codec, title, isDefault, forced } = t;
    return [
      {
        id: isFile(t) ? t.id : `e${index}`,
        source: isFile(t) ? ("file" as const) : ("embedded" as const),
        index,
        codec,
        language: t.language ? subtitleLanguage(t.language) : null,
        title,
        isDefault,
        forced,
        sdh: t.sdh ?? /\b(?:sdh|cc|hearing)/i.test(title ?? ""),
      },
    ];
  });
}

/** Keeps what's inside the video and replaces the files beside it. */
export const withSubtitleFiles = (stored: StoredSubtitle[], files: SubtitleFile[]): StoredSubtitle[] => [...stored.filter((t) => !isFile(t)), ...files];

export const subtitleFiles = (stored: StoredSubtitle[]): SubtitleFile[] => stored.filter(isFile);

const root = () => path.join(env.dataDir, "subtitles");
const folderOf = (videoId: string, mtimeMs: number) => path.join(root(), videoId, String(mtimeMs));

interface Job {
  done: Promise<void>;
  failed: HttpError | null;
  failedAt: number;
}
const jobs = new Map<string, Job>();

/** Reads every text track out of the video, once however many players ask. */
function extract(videoId: string, folder: string, file: string, tracks: number[]): Job {
  const key = `${videoId}/${folder}`;
  const running = jobs.get(key);
  if (running && (!running.failed || Date.now() - running.failedAt < FAILED_MS)) return running;
  const job: Job = { done: Promise.resolve(), failed: null, failedAt: 0 };
  jobs.set(key, job);
  job.done = (async () => {
    const started = Date.now();
    try {
      const { tracks: made } = await extractSubtitles(file, tracks);
      await fs.mkdir(folder, { recursive: true });
      await Promise.all(
        Object.entries(made).map(async ([index, vtt]) => {
          // Moved into place whole, since another player can ask for it at any moment.
          const saved = path.join(folder, `e${index}.vtt`);
          await fs.writeFile(`${saved}.tmp`, vtt);
          await fs.rename(`${saved}.tmp`, saved);
        }),
      );
      log.info("subtitles read", { video: videoId, tracks: tracks.length, ms: Date.now() - started });
      jobs.delete(key);
    } catch (err) {
      log.warn("subtitles could not be read", { video: videoId, error: errorMessage(err) });
      // The add-on's own words can name paths on the server, so they stay in the log.
      job.failed = isHttpError(err) && err.status === 503 ? err : new HttpError(422, "These subtitles couldn't be read.");
      job.failedAt = Date.now();
    }
  })();
  return job;
}

/** A subtitle track as WebVTT. Throws a 503 with Retry-After while it's still being read from the video. */
export async function subtitleVtt(ctx: AppContext, videoId: string, trackId: string, offset: number): Promise<string> {
  const video = getVideoFile(ctx, videoId);
  const row = ctx.sqlite.prepare("SELECT mtime_ms, subtitle_tracks FROM videos WHERE id = ?").get(videoId) as { mtime_ms: number; subtitle_tracks: string } | undefined;
  if (!video?.root || !row) throw new HttpError(404, "Video not found.");
  const stored = JSON.parse(row.subtitle_tracks) as StoredSubtitle[];
  const track = shownSubtitles(stored).find((t) => t.id === trackId);
  if (!track) throw new HttpError(404, "That subtitle isn't there.");
  const finish = (source: string) => cuesToVtt(parseCues(source), offset);

  if (track.source === "file") {
    const file = subtitleFiles(stored).find((t) => t.id === trackId)!;
    return finish(decodeSubtitle(await fs.readFile(resolveInside(video.root, file.file))));
  }
  const folder = folderOf(videoId, row.mtime_ms);
  const saved = path.join(folder, `${trackId}.vtt`);
  const read = () => fs.readFile(saved, "utf8").catch(() => null);
  const cached = await read();
  if (cached !== null) return finish(cached);
  const embedded = shownSubtitles(stored).filter((t) => t.source === "embedded").map((t) => t.index);
  const job = extract(videoId, folder, resolveInside(video.root, video.relPath), embedded);
  await Promise.race([job.done, new Promise((resolve) => setTimeout(resolve, WAIT_MS))]);
  if (job.failed) throw job.failed;
  const made = await read();
  if (made === null) throw STILL_MAKING();
  return finish(made);
}

/** Removes what's kept for videos that are gone or whose file changed. A folder that won't go is left for next time. */
export async function pruneSubtitles(ctx: Pick<AppContext, "sqlite">) {
  const videos = await fs.readdir(root()).catch(() => [] as string[]);
  const row = ctx.sqlite.prepare("SELECT mtime_ms FROM videos WHERE id = ?");
  await Promise.all(
    videos.map(async (id) => {
      const video = row.get(id) as { mtime_ms: number } | undefined;
      const folders = video ? await fs.readdir(path.join(root(), id)).catch(() => [] as string[]) : [];
      const gone = video ? folders.filter((f) => f !== String(video.mtime_ms)).map((f) => path.join(id, f)) : [id];
      await Promise.all(gone.map((p) => fs.rm(path.join(root(), p), { recursive: true, force: true }).catch(() => undefined)));
    }),
  );
}
