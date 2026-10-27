import { useSyncExternalStore } from "react";
import { Directory, File, Paths } from "expo-file-system";
import {
  type AlbumDetail,
  apiPaths,
  type BookDetail,
  type EpisodeAdsDto,
  type EpisodeWithShow,
  type ItemType,
  type TrackDto,
} from "@murmur/shared/client";
import { absolute, api, authHeaders } from "./api";
import { getJson, setJson } from "./storage";

// Books, episodes and music saved on the phone for offline listening. Each download keeps a copy
// of the item's details too, so it can be opened and played with no connection at all. An album
// is one download of all its songs; a song can also be downloaded on its own.

const INDEX_KEY = "murmur.downloads";

export type DownloadType = ItemType | "album" | "track";

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
  | { type: "episode"; episode: EpisodeWithShow; ads?: EpisodeAdsDto }
  /** Files are indexed by the song's place in `album.tracks`. */
  | { type: "album"; album: AlbumDetail }
  | { type: "track"; track: TrackDto }
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

function commit(next: Index, progressOnly = false) {
  index = next;
  if (!progressOnly) {
    listed = next;
    setJson(INDEX_KEY, next);
  }
  listeners.forEach((l) => l());
}

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
  const d = index[keyOf(type, id)];
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
  const key = keyOf("episode", episode.id);
  if (index[key]?.status === "downloading") return;
  commit({
    ...index,
    [key]: { type: "episode", id: episode.id, episode, status: "downloading", progress: 0, bytes: 0, files: {}, savedAt: Date.now() },
  });
  void run(key, "episode", episode.id, [
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

/** Keeps a downloaded episode's saved ad times up to date; no-op when it isn't downloaded. */
export function saveDownloadAds(episodeId: string, ads: EpisodeAdsDto) {
  const key = keyOf("episode", episodeId);
  const cur = index[key];
  if (cur?.type !== "episode" || JSON.stringify(cur.ads) === JSON.stringify(ads)) return;
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
