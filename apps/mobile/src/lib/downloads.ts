import { useSyncExternalStore } from "react";
import { Directory, File, Paths } from "expo-file-system";
import {
  type AlbumDetail,
  apiPaths,
  type BookDetail,
  type EpisodeAdsDto,
  type EpisodeWithShow,
  type ItemType,
  type MovieDetail,
  type ShowDetail,
  type TrackDto,
  type VideoDownloadDto,
  type VideoEpisode,
  type WatchDownloadQuery,
} from "@murmur/shared/client";
import { absolute, api, authHeaders, HttpError } from "./api";
import { getJson, setJson } from "./storage";

// Books, episodes, music, movies and TV episodes saved on the phone for offline listening and
// watching. Each download keeps a copy of the item's details too, so it can be opened and played
// with no connection at all. An album is one download of all its songs; a song can also be
// downloaded on its own. A movie or TV episode is one video file, plus its pictures.

const INDEX_KEY = "murmur.downloads";

/** "podcast" is a podcast episode; "show" is a TV show's episode. */
export type DownloadType = "book" | "podcast" | "album" | "track" | "movie" | "show";

/** The download type of something the audio player plays. */
export const downloadTypeOf = (itemType: ItemType): DownloadType => (itemType === "episode" ? "podcast" : itemType);

/**
 * Where a video downloads from: the file as it is, or an MP4 the server makes first (`request`)
 * and then hands over. `track` is the audio track the copy plays (all of them for a file saved as
 * it is, where it's the one that was picked).
 */
export type VideoDownloadSource =
  | { made: false; url: string; track: number }
  | { made: true; videoId: string; request: WatchDownloadQuery; track: number };

/** How much of a made download's progress bar is the server making it; the rest is fetching it. */
const MAKING_SHARE = 0.9;
const MAKING_POLL_MS = 3000;

export type Download = {
  type: DownloadType;
  id: string;
  status: "downloading" | "done" | "error";
  /** 0..1 while downloading. */
  progress: number;
  bytes: number;
  /** Local file URIs by file index. */
  files: Record<number, string>;
  savedAt: number;
  error?: string;
} & (
  | { type: "book"; book: BookDetail }
  /** `ads`: the episode's ad times as of the download (kept fresh while playing online). */
  | { type: "podcast"; episode: EpisodeWithShow; ads?: EpisodeAdsDto }
  /** Files are indexed by the song's place in `album.tracks`. */
  | { type: "album"; album: AlbumDetail }
  | { type: "track"; track: TrackDto }
  /** `versionId`: the version saved. `art`: saved pictures, by their server path. */
  | { type: "movie"; movie: MovieDetail; versionId: string; source: VideoDownloadSource; art: Record<string, string> }
  | { type: "show"; episode: VideoEpisode; show: ShowDetail; source: VideoDownloadSource; art: Record<string, string> }
);

type Index = Record<string, Download>;

const keyOf = (type: DownloadType, id: string) => `${type}:${id}`;
const listeners = new Set<() => void>();
let index: Index = getJson<Index>(INDEX_KEY) ?? {};

// A download cut off by the app being closed can't resume; show it as failed so it can be retried.
for (const d of Object.values(index)) {
  if (d.status === "downloading") index[keyOf(d.type, d.id)] = { ...d, status: "error", error: "Interrupted." };
}

// What list screens see. Progress ticks leave it alone, so a running download only redraws its
// own row (useDownload), not every screen that lists downloads.
let listed: Index = index;

/** Saved movie and TV pictures by server path, for Cover to show offline. */
let art = new Map<string, string>();
const indexArt = (i: Index) => {
  art = new Map(Object.values(i).flatMap((d) => (d.type === "movie" || d.type === "show" ? Object.entries(d.art) : [])));
};
indexArt(index);

function commit(next: Index, progressOnly = false) {
  index = next;
  if (!progressOnly) {
    listed = next;
    setJson(INDEX_KEY, next);
    indexArt(next);
  }
  listeners.forEach((l) => l());
}

/** The saved copy of a movie or TV picture, when one was downloaded with it. */
export const savedArt = (path: string): string | undefined => art.get(path);

function patch(key: string, change: Partial<Download>) {
  const cur = index[key];
  if (cur) commit({ ...index, [key]: { ...cur, ...change } as Download });
}

/** Progress isn't saved: a download cut off by closing the app restarts from the beginning anyway. */
function setProgress(key: string, progress: number) {
  const cur = index[key];
  if (cur) commit({ ...index, [key]: { ...cur, progress } }, true);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Every download, for lists. Progress here can lag; read a row's live progress with useDownload. */
export function useDownloads(): Index {
  return useSyncExternalStore(subscribe, () => listed);
}

export function useDownload(type: DownloadType, id: string): Download | undefined {
  return useSyncExternalStore(subscribe, () => index[keyOf(type, id)]);
}

export function getDownload(type: DownloadType, id: string): Download | undefined {
  return index[keyOf(type, id)];
}

/** Where a song is saved: on its own, or as part of an album download. */
function savedSong(trackId: string): { uri: string | undefined; track: TrackDto } | null {
  const own = index[keyOf("track", trackId)];
  if (own?.type === "track") return { uri: own.files[0], track: own.track };
  for (const d of Object.values(index)) {
    if (d.type !== "album") continue;
    const at = d.album.tracks.findIndex((t) => t.id === trackId);
    if (at >= 0) return { uri: d.files[at], track: d.album.tracks[at]! };
  }
  return null;
}

/** The local copy of a song, once its file is fully saved (an album's songs count one by one). */
export function localTrackUri(trackId: string): string | null {
  const uri = savedSong(trackId)?.uri;
  return uri && new File(uri).exists ? uri : null;
}

/** A downloaded song's details, for playing it with no connection. */
export const savedTrack = (trackId: string): TrackDto | null => savedSong(trackId)?.track ?? null;

/** Whether a song is saved as part of a downloaded (or downloading) album. */
export function useInAlbumDownload(track: TrackDto): boolean {
  return useSyncExternalStore(subscribe, () => index[keyOf("album", track.albumId)] !== undefined);
}

/** The local copy of one file, if it's fully downloaded and still on disk. */
export function localUri(type: ItemType, id: string, fileIndex: number): string | null {
  const d = index[keyOf(downloadTypeOf(type), id)];
  const uri = d?.status === "done" ? d.files[fileIndex] : undefined;
  if (!uri) return null;
  return new File(uri).exists ? uri : null;
}

const EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/x-m4b": "m4b",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

function folderFor(type: DownloadType, id: string): Directory {
  return new Directory(Paths.document, "downloads", `${type}-${id}`);
}

const active = new Map<string, AbortController>();

async function run(key: string, type: DownloadType, id: string, files: { index: number; url: string; mime: string; durationSec: number }[]) {
  const folder = folderFor(type, id);
  folder.create({ intermediates: true, idempotent: true });
  const abort = new AbortController();
  active.set(key, abort);
  const total = files.reduce((n, f) => n + Math.max(1, f.durationSec), 0);
  let doneWeight = 0;
  const saved: Record<number, string> = {};
  let bytes = 0;
  try {
    for (const f of files) {
      if (abort.signal.aborted) return;
      const dest = new File(folder, `${f.index}.${EXT[f.mime] ?? "audio"}`);
      if (dest.exists) dest.delete();
      const weight = Math.max(1, f.durationSec);
      let lastUpdate = 0;
      const task = File.createDownloadTask(absolute(f.url), dest, {
        headers: authHeaders(),
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (Date.now() - lastUpdate < 500 || totalBytes <= 0) return;
          lastUpdate = Date.now();
          setProgress(key, (doneWeight + (bytesWritten / totalBytes) * weight) / total);
        },
      });
      abort.signal.addEventListener("abort", () => task.cancel());
      const file = await task.downloadAsync();
      if (!file) throw new Error("Download stopped.");
      saved[f.index] = file.uri;
      bytes += file.size;
      doneWeight += weight;
      patch(key, { progress: doneWeight / total, files: { ...saved }, bytes });
    }
    patch(key, { status: "done", progress: 1 });
  } catch (err) {
    if (abort.signal.aborted) return;
    patch(key, { status: "error", error: err instanceof Error ? err.message : "Download failed." });
  } finally {
    active.delete(key);
  }
}

export function downloadBook(book: BookDetail) {
  const key = keyOf("book", book.id);
  if (index[key]?.status === "downloading") return;
  commit({ ...index, [key]: { type: "book", id: book.id, book, status: "downloading", progress: 0, bytes: 0, files: {}, savedAt: Date.now() } });
  void run(
    key,
    "book",
    book.id,
    book.files.map((f) => ({ index: f.index, url: apiPaths.bookFileUrl(book.id, f.index), mime: f.mimeType, durationSec: f.durationSec })),
  );
}

export function downloadEpisode(episode: EpisodeWithShow) {
  const key = keyOf("podcast", episode.id);
  if (index[key]?.status === "downloading") return;
  commit({
    ...index,
    [key]: { type: "podcast", id: episode.id, episode, status: "downloading", progress: 0, bytes: 0, files: {}, savedAt: Date.now() },
  });
  void run(key, "podcast", episode.id, [
    { index: 0, url: apiPaths.episodeUrl(episode.id), mime: "audio/mpeg", durationSec: episode.durationSec ?? 0 },
  ]);
  // Ad times go with it, so marks and Auto-skip work offline. No ads (or no connection) just
  // means none are saved.
  void api<EpisodeAdsDto>(apiPaths.episodeAds(episode.id))
    .then((ads) => saveDownloadAds(episode.id, ads))
    .catch(() => undefined);
}

/** Every song on an album, as one download. */
export function downloadAlbum(album: AlbumDetail) {
  const key = keyOf("album", album.id);
  if (index[key]?.status === "downloading") return;
  commit({ ...index, [key]: { type: "album", id: album.id, album, status: "downloading", progress: 0, bytes: 0, files: {}, savedAt: Date.now() } });
  void run(
    key,
    "album",
    album.id,
    album.tracks.map((t, i) => ({ index: i, url: apiPaths.trackUrl(t.id), mime: t.mimeType, durationSec: t.durationSec })),
  );
}

export function downloadTrack(track: TrackDto) {
  const key = keyOf("track", track.id);
  if (index[key]?.status === "downloading") return;
  commit({ ...index, [key]: { type: "track", id: track.id, track, status: "downloading", progress: 0, bytes: 0, files: {}, savedAt: Date.now() } });
  void run(key, "track", track.id, [{ index: 0, url: apiPaths.trackUrl(track.id), mime: track.mimeType, durationSec: track.durationSec }]);
}

// ---------- Movies and TV episodes ----------

// Videos download one at a time: they're big, and the server makes one converted copy per person
// at a time (it answers 429 to a second).
const videoQueue: string[] = [];
let videoRunning = false;

async function pumpVideos() {
  if (videoRunning) return;
  videoRunning = true;
  try {
    for (let key = videoQueue.shift(); key; key = videoQueue.shift()) {
      if (index[key]?.status === "downloading") await runVideo(key);
    }
  } finally {
    videoRunning = false;
  }
}

/** The file's own extension where it's saved as it is; Media3 reads the contents either way. */
function videoExt(source: VideoDownloadSource, container: string): string {
  if (source.made || /mp4|mov/.test(container)) return "mp4";
  if (container.includes("matroska")) return "mkv";
  return container.split(",")[0] || "video";
}

async function runVideo(key: string) {
  const d = index[key];
  if (d?.type !== "movie" && d?.type !== "show") return;
  const folder = folderFor(d.type, d.id);
  folder.create({ intermediates: true, idempotent: true });
  const abort = new AbortController();
  active.set(key, abort);
  const file = d.type === "movie" ? d.movie.versionList.find((v) => v.id === d.versionId)?.file : d.episode.file;
  const dest = new File(folder, `video.${videoExt(d.source, file?.container ?? "")}`);
  const source = d.source;
  let job: string | null = null;
  // Cancelling stops the server making it too, and frees its copy.
  const dropJob = () => {
    if (job) void api(apiPaths.videoDownloadFile(job), { method: "DELETE" }).catch(() => undefined);
    job = null;
  };
  abort.signal.addEventListener("abort", dropJob);
  /** The server makes the MP4 first: asks how far it's got (the same request finds the same job) until it's ready. */
  const prepare = async (want: VideoDownloadSource & { made: true }): Promise<string | null> => {
    for (;;) {
      try {
        const made = await api<VideoDownloadDto>(apiPaths.videoDownload(want.videoId), { method: "POST", body: want.request });
        if (abort.signal.aborted) return null;
        job = made.id;
        if (made.status === "failed") throw new Error(made.error ?? "The server couldn't make this video.");
        if (made.status === "ready") return made.fileUrl;
        setProgress(key, made.progress * MAKING_SHARE);
      } catch (err) {
        // 429: another converted download of yours is running (on the web, say); wait for it.
        if (!(err instanceof HttpError && err.status === 429)) throw err;
      }
      await new Promise((r) => setTimeout(r, MAKING_POLL_MS));
      if (abort.signal.aborted) return null;
    }
  };
  const fetchFile = async (url: string, start: number) => {
    if (dest.exists) dest.delete();
    let lastUpdate = 0;
    const task = File.createDownloadTask(absolute(url), dest, {
      headers: authHeaders(),
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (Date.now() - lastUpdate < 500 || totalBytes <= 0) return;
        lastUpdate = Date.now();
        setProgress(key, start + (bytesWritten / totalBytes) * (1 - start));
      },
    });
    abort.signal.addEventListener("abort", () => task.cancel());
    return task.downloadAsync();
  };
  try {
    let saved: File | null | undefined;
    if (source.made) {
      const url = await prepare(source);
      if (!url) return;
      saved = await fetchFile(url, MAKING_SHARE).catch(() => null);
      // The server's copy expires a few hours after it's made: make it again and fetch once more.
      if (!saved?.size && !abort.signal.aborted) {
        const again = await prepare(source);
        if (!again) return;
        saved = await fetchFile(again, MAKING_SHARE);
      }
    } else {
      saved = await fetchFile(source.url, 0);
    }
    if (abort.signal.aborted) return;
    if (!saved || !saved.size) throw new Error("Download stopped.");
    patch(key, { status: "done", progress: 1, files: { 0: saved.uri }, bytes: saved.size });
    // The phone has it now; the server's copy can go.
    dropJob();
  } catch (err) {
    if (abort.signal.aborted) return;
    patch(key, { status: "error", error: err instanceof Error ? err.message : "Download failed." });
  } finally {
    active.delete(key);
  }
}

/** "Preparing 40%" while the server makes a video, else "Downloading 95%": a running download's status line. */
export function downloadingText(d: Download): string {
  if ((d.type === "movie" || d.type === "show") && d.source.made && d.progress < MAKING_SHARE) {
    return `Preparing ${Math.round((d.progress / MAKING_SHARE) * 100)}%`;
  }
  return `Downloading ${Math.round(d.progress * 100)}%`;
}

/** Saves a movie's or episode's pictures beside it, so its pages and rows show them offline. */
async function saveArt(key: string, type: "movie" | "show", id: string, paths: string[]) {
  const folder = folderFor(type, id);
  folder.create({ intermediates: true, idempotent: true });
  const saved: Record<string, string> = {};
  await Promise.all(
    paths.map(async (path, i) => {
      try {
        const dest = new File(folder, `art-${i}.jpg`);
        if (dest.exists) dest.delete();
        const file = await File.createDownloadTask(absolute(path), dest, { headers: authHeaders() }).downloadAsync();
        if (file) saved[path] = file.uri;
      } catch {
        // A missing picture shows its tinted tile instead.
      }
    }),
  );
  const cur = index[key];
  if (cur?.type === "movie" || cur?.type === "show") commit({ ...index, [key]: { ...cur, art: saved } });
}

function startVideo(key: string, entry: Download & { type: "movie" | "show" }, artPaths: string[]) {
  commit({ ...index, [key]: entry });
  videoQueue.push(key);
  void pumpVideos();
  void saveArt(key, entry.type, entry.id, artPaths);
}

/** One version of a movie (by default the first), with its poster, backdrop and still. */
export function downloadMovie(movie: MovieDetail, versionId: string, source: VideoDownloadSource) {
  const key = keyOf("movie", movie.id);
  if (index[key]?.status === "downloading") return;
  const version = movie.versionList.find((v) => v.id === versionId) ?? movie.versionList[0]!;
  const art = [
    ...(movie.posterHash
      ? [apiPaths.movieArtUrl(movie.id, "poster", movie.posterHash, "small"), apiPaths.movieArtUrl(movie.id, "poster", movie.posterHash)]
      : []),
    ...(movie.backdropHash ? [apiPaths.movieArtUrl(movie.id, "backdrop", movie.backdropHash)] : []),
    ...(version.stillHash ? [apiPaths.videoStillUrl(version.id, version.stillHash, "small")] : []),
  ];
  const entry = { type: "movie", id: movie.id, movie, versionId: version.id, source, art: {}, status: "downloading", progress: 0, bytes: 0, files: {}, savedAt: Date.now() } as const;
  startVideo(key, entry, art);
}

/** A TV episode, with a copy of its show's details and pictures. */
export function downloadTvEpisode(show: ShowDetail, episode: VideoEpisode, source: VideoDownloadSource) {
  const key = keyOf("show", episode.id);
  if (index[key]?.status === "downloading") return;
  const art = [
    ...(show.posterHash
      ? [apiPaths.showArtUrl(show.id, "poster", show.posterHash, "small"), apiPaths.showArtUrl(show.id, "poster", show.posterHash)]
      : []),
    ...(show.backdropHash ? [apiPaths.showArtUrl(show.id, "backdrop", show.backdropHash)] : []),
    ...(episode.stillHash ? [apiPaths.videoStillUrl(episode.id, episode.stillHash, "small")] : []),
  ];
  const entry = { type: "show", id: episode.id, episode, show, source, art: {}, status: "downloading", progress: 0, bytes: 0, files: {}, savedAt: Date.now() } as const;
  startVideo(key, entry, art);
}

/** The saved file for a movie version or TV episode, once it's complete, with the audio track it holds. */
export function localVideo(videoId: string): { uri: string; track: number; made: boolean } | null {
  for (const d of Object.values(index)) {
    if (d.status !== "done" || !d.files[0]) continue;
    const match = (d.type === "movie" && d.versionId === videoId) || (d.type === "show" && d.id === videoId);
    if (match && new File(d.files[0]).exists) return { uri: d.files[0], track: d.source.track, made: d.source.made };
  }
  return null;
}

/** A downloaded movie's saved details, for opening it with no connection. */
export function savedMovie(id: string): MovieDetail | undefined {
  const d = index[keyOf("movie", id)];
  return d?.type === "movie" ? d.movie : undefined;
}

/** A show's saved details from its newest downloaded episode, for opening it with no connection. */
export function savedShow(id: string): ShowDetail | undefined {
  let best: (Download & { type: "show" }) | undefined;
  for (const d of Object.values(index)) {
    if (d.type === "show" && d.show.id === id && (!best || d.savedAt > best.savedAt)) best = d;
  }
  return best?.show;
}

/** Keeps a downloaded episode's saved ad times up to date; no-op when it isn't downloaded. */
export function saveDownloadAds(episodeId: string, ads: EpisodeAdsDto) {
  const key = keyOf("podcast", episodeId);
  const cur = index[key];
  if (cur?.type !== "podcast" || JSON.stringify(cur.ads) === JSON.stringify(ads)) return;
  commit({ ...index, [key]: { ...cur, ads } });
}

export function removeDownload(type: DownloadType, id: string) {
  const key = keyOf(type, id);
  active.get(key)?.abort();
  const folder = folderFor(type, id);
  if (folder.exists) folder.delete();
  const { [key]: _removed, ...rest } = index;
  commit(rest);
}

export function downloadedBytes(): number {
  return Object.values(index).reduce((n, d) => n + d.bytes, 0);
}

export function removeAllDownloads() {
  for (const d of Object.values(index)) removeDownload(d.type, d.id);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
