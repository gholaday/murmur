import fs from "node:fs/promises";
import path from "node:path";
import type { Sqlite } from "../db";
import { newId } from "../ids";
import { errorMessage, type Logger } from "../log";
import { pickCoverImage, storeCover } from "../library/covers";
import type { LibraryFolder } from "../library/folders";
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, extname, mimeTypeFor } from "../library/parse";
import { createLimiter, createUnreadable, extractEmbeddedCover, probeFile } from "../library/probe";
import { emptyStats, fileDetails, fileRows, type FoundFile, runScan, type ScanState, walkTree } from "../library/scan-loop";
import { nameKey, sortName, trackInfo } from "./parse";
import { bumpChanges } from "../changes";

// The music scanner. Unlike books, music is read file by file: a song is probed only when
// its size or modified time changed, and albums come from the tags, not from folders.

interface MusicScannerDeps {
  sqlite: Sqlite;
  /** The music folders, looked up at the start of every scan. */
  folders: () => LibraryFolder[];
  coversDir: string;
  probeConcurrency: number;
  missingGraceMs: number;
  log: Logger;
  state: ScanState;
  /** Runs after each scan, for lookups that need the new albums (artist photos). */
  afterScan?: () => Promise<void>;
}

interface Walked {
  audio: FoundFile[];
  /** Image names by folder (relative, forward slashes), for album covers. */
  images: Map<string, string[]>;
}

/** Every audio file under a music folder, and the images next to them. */
async function walk(root: string, log: Logger): Promise<Walked> {
  const out: Walked = { audio: [], images: new Map() };
  await walkTree(root, log, async (rel, files) => {
    const images: string[] = [];
    await Promise.all(
      files.map(async ({ name, relPath }) => {
        const ext = extname(name);
        if (IMAGE_EXTENSIONS.has(ext)) images.push(name);
        else if (AUDIO_EXTENSIONS.has(ext)) out.audio.push(await fileDetails(root, relPath));
      }),
    );
    if (images.length) out.images.set(rel, images);
  });
  return out;
}

export function createMusicScanner(deps: MusicScannerDeps) {
  const { sqlite, log, state } = deps;
  const probeLimit = createLimiter(Math.max(1, deps.probeConcurrency));
  const unreadable = createUnreadable();
  const rows = fileRows(sqlite, "tracks");

  const findArtist = sqlite.prepare("SELECT id FROM artists WHERE name_key = ?");
  const insertArtist = sqlite.prepare("INSERT INTO artists (id, name, name_key, sort_name, created_at) VALUES (?, ?, ?, ?, ?)");
  const findAlbum = sqlite.prepare("SELECT id FROM albums WHERE artist_id = ? AND title_key = ?");
  const insertAlbum = sqlite.prepare(
    "INSERT INTO albums (id, artist_id, title, title_key, year, genre, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const fillAlbum = sqlite.prepare(
    "UPDATE albums SET year = COALESCE(year, ?), genre = COALESCE(genre, ?), updated_at = ? WHERE id = ?",
  );
  const upsertTrack = sqlite.prepare(`
    INSERT INTO tracks (id, album_id, artist_id, folder_id, rel_path, title, disc_no, track_no, duration_sec,
                        size, mtime_ms, mime_type, has_embedded_cover, added_at, missing_since)
    VALUES (@id, @albumId, @artistId, @folderId, @relPath, @title, @discNo, @trackNo, @durationSec,
            @size, @mtimeMs, @mimeType, @hasEmbeddedCover, @now, NULL)
    ON CONFLICT (folder_id, rel_path) DO UPDATE SET
      album_id = excluded.album_id, artist_id = excluded.artist_id, title = excluded.title,
      disc_no = excluded.disc_no, track_no = excluded.track_no, duration_sec = excluded.duration_sec,
      size = excluded.size, mtime_ms = excluded.mtime_ms, mime_type = excluded.mime_type,
      has_embedded_cover = excluded.has_embedded_cover, missing_since = NULL`);

  function artistId(name: string, now: number): string {
    const key = nameKey(name);
    const row = findArtist.get(key) as { id: string } | undefined;
    if (row) return row.id;
    const id = newId();
    insertArtist.run(id, name.trim(), key, sortName(name), now);
    return id;
  }

  function albumId(artist: string, title: string, year: string | null, genre: string | null, now: number): string {
    const key = nameKey(title);
    const row = findAlbum.get(artist, key) as { id: string } | undefined;
    if (row) {
      fillAlbum.run(year, genre, now, row.id);
      return row.id;
    }
    const id = newId();
    insertAlbum.run(id, artist, title.trim(), key, year, genre, now, now);
    return id;
  }

  async function importTrack(folder: LibraryFolder, file: FoundFile, now: number): Promise<boolean> {
    const key = `${folder.id}:${file.relPath}`;
    if (unreadable.skip(key, file)) return false;
    let probe;
    try {
      probe = await probeLimit(() => probeFile(path.join(folder.path, file.relPath)));
      unreadable.read(key);
    } catch (err) {
      log.warn("song could not be read", { file: file.relPath, error: errorMessage(err) });
      unreadable.failed(key, file);
      return false;
    }
    const info = trackInfo(file.relPath, probe.tags);
    sqlite.transaction(() => {
      const albumArtist = artistId(info.albumArtist, now);
      const songArtist = nameKey(info.artist) === nameKey(info.albumArtist) ? albumArtist : artistId(info.artist, now);
      upsertTrack.run({
        id: newId(),
        albumId: albumId(albumArtist, info.album, info.year, info.genre, now),
        artistId: songArtist,
        folderId: folder.id,
        relPath: file.relPath,
        title: info.title,
        discNo: info.discNo,
        trackNo: info.trackNo,
        durationSec: probe.durationSec,
        size: file.size,
        mtimeMs: file.mtimeMs,
        mimeType: mimeTypeFor(file.relPath),
        hasEmbeddedCover: probe.hasEmbeddedCover ? 1 : 0,
        now,
      });
    })();
    return true;
  }

  /** Albums with no cover yet: an image beside the songs first, else one embedded in a song. */
  async function fillCovers(images: Map<number, Map<string, string[]>>) {
    const pending = sqlite
      .prepare(
        `SELECT a.id, t.folder_id AS folderId, t.rel_path AS relPath, t.has_embedded_cover AS embedded
         FROM albums a JOIN tracks t ON t.album_id = a.id
         WHERE a.cover_hash IS NULL AND t.missing_since IS NULL AND t.folder_id IS NOT NULL
         ORDER BY a.id, t.has_embedded_cover DESC, t.disc_no, t.track_no`,
      )
      .all() as Array<{ id: string; folderId: number; relPath: string; embedded: number }>;
    const roots = new Map(deps.folders().map((f) => [f.id, f.path]));
    const setCover = sqlite.prepare("UPDATE albums SET cover_hash = ? WHERE id = ?");
    const byAlbum = new Map<string, typeof pending>();
    for (const row of pending) byAlbum.set(row.id, [...(byAlbum.get(row.id) ?? []), row]);
    for (const [id, songs] of byAlbum) {
      const first = songs[0]!;
      const root = roots.get(first.folderId);
      if (!root) continue;
      try {
        const dir = path.posix.dirname(first.relPath);
        const names = images.get(first.folderId)?.get(dir === "." ? "" : dir) ?? [];
        const image = pickCoverImage(names);
        let bytes: Buffer | null = null;
        if (image) bytes = await fs.readFile(path.join(root, dir, image));
        else if (first.embedded) bytes = await extractEmbeddedCover(path.join(root, first.relPath));
        if (bytes) setCover.run(await storeCover(deps.coversDir, bytes), id);
      } catch (err) {
        log.warn("album cover could not be processed", { file: first.relPath, error: errorMessage(err) });
      }
    }
  }

  async function runOnce() {
    const now = Date.now();
    const stats = emptyStats();
    const problems: string[] = [];
    const images = new Map<number, Map<string, string[]>>();

    for (const folder of deps.folders()) {
      let walked: Walked;
      try {
        walked = await walk(folder.path, log);
      } catch (err) {
        // An unreachable folder (unmounted share) must not mark its whole collection missing.
        problems.push(`${folder.path} can't be read: ${errorMessage(err)}.`);
        continue;
      }
      images.set(folder.id, walked.images);
      stats.found += walked.audio.length;
      const existing = rows.inFolder(folder.id);
      await Promise.all(
        walked.audio.map(async (file) => {
          const row = existing.get(file.relPath);
          existing.delete(file.relPath);
          if (rows.unchanged(row, file)) {
            stats.unchanged++;
            return;
          }
          if (await importTrack(folder, file, now)) {
            stats[row ? "updated" : "added"]++;
            bumpChanges("music");
          } else stats.failed++;
        }),
      );
      stats.missing += rows.markMissing(existing.values(), now);
    }

    // Gone long enough, or their folder was removed: delete them, then anything left empty.
    stats.removed = rows.removeExpired(now, deps.missingGraceMs);
    sqlite.prepare("DELETE FROM albums WHERE id NOT IN (SELECT album_id FROM tracks)").run();
    sqlite
      .prepare("DELETE FROM artists WHERE id NOT IN (SELECT artist_id FROM albums) AND id NOT IN (SELECT artist_id FROM tracks)")
      .run();

    await fillCovers(images);
    // Covers too, so one more reload after the files.
    if (stats.added || stats.updated || stats.missing || stats.removed) bumpChanges("music");
    return { stats, problems };
  }

  /** Scans every music folder. If a scan is already running, another pass starts right after. */
  function scan(): Promise<void> {
    return runScan({
      state,
      log,
      name: "music scan",
      afterScan: deps.afterScan,
      once: runOnce,
    });
  }

  return { scan };
}

export type MusicScanner = ReturnType<typeof createMusicScanner>;
