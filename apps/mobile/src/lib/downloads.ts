import { useSyncExternalStore } from "react";
import { Directory, File, Paths } from "expo-file-system";
import { apiPaths, type BookDetail, type EpisodeWithShow, type ItemType } from "@murmur/shared";
import { absolute, authHeaders } from "./api";
import { getJson, setJson } from "./storage";

// Books and episodes saved on the phone for offline listening. Each download keeps a copy of
// the item's details too, so it can be opened and played with no connection at all.

const INDEX_KEY = "murmur.downloads";

export type Download = {
  type: ItemType;
  id: string;
  status: "downloading" | "done" | "error";
  /** 0..1 while downloading. */
  progress: number;
  bytes: number;
  /** Local file URIs by file index. */
  files: Record<number, string>;
  savedAt: number;
  error?: string;
} & ({ type: "book"; book: BookDetail } | { type: "episode"; episode: EpisodeWithShow });

type Index = Record<string, Download>;

const keyOf = (type: ItemType, id: string) => `${type}:${id}`;
const listeners = new Set<() => void>();
let index: Index = getJson<Index>(INDEX_KEY) ?? {};

// A download cut off by the app being closed can't resume; show it as failed so it can be retried.
for (const d of Object.values(index)) {
  if (d.status === "downloading") index[keyOf(d.type, d.id)] = { ...d, status: "error", error: "Interrupted." };
}

function commit(next: Index) {
  index = next;
  setJson(INDEX_KEY, next);
  listeners.forEach((l) => l());
}

function patch(key: string, change: Partial<Download>) {
  const cur = index[key];
  if (cur) commit({ ...index, [key]: { ...cur, ...change } as Download });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useDownloads(): Index {
  return useSyncExternalStore(subscribe, () => index);
}

export function useDownload(type: ItemType, id: string): Download | undefined {
  return useSyncExternalStore(subscribe, () => index[keyOf(type, id)]);
}

export function getDownload(type: ItemType, id: string): Download | undefined {
  return index[keyOf(type, id)];
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
};

function folderFor(type: ItemType, id: string): Directory {
  return new Directory(Paths.document, "downloads", `${type}-${id}`);
}

const active = new Map<string, AbortController>();

async function run(key: string, type: ItemType, id: string, files: Array<{ index: number; url: string; mime: string; durationSec: number }>) {
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
          patch(key, { progress: (doneWeight + (bytesWritten / totalBytes) * weight) / total });
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
}

export function removeDownload(type: ItemType, id: string) {
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
