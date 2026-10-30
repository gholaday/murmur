import crypto from "node:crypto";
import type { PlaylistDetail, PlaylistSummary } from "@murmur/shared";
import type { AppContext } from "../context";
import { HttpError } from "../http";
import { tracksByIds } from "./queries";

// Playlists belong to one person: nobody else sees them, and every call checks the owner.
// Songs keep their order in `position`; replacing the order rewrites them all, which is fine
// at playlist sizes and keeps reorder and remove to one call.

const newId = () => crypto.randomBytes(9).toString("base64url");
const COVERS = 4;

interface PlaylistRow {
  id: string;
  name: string;
  updated_at: number;
}

/** The playlist's song ids in order, skipping songs whose file has gone missing. */
function songIds(ctx: AppContext, playlistId: string): string[] {
  return (
    ctx.sqlite
      .prepare(
        `SELECT pt.track_id AS id FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
         WHERE pt.playlist_id = ? AND t.missing_since IS NULL ORDER BY pt.position`,
      )
      .all(playlistId) as Array<{ id: string }>
  ).map((r) => r.id);
}

function owned(ctx: AppContext, userId: number, id: string): PlaylistRow {
  const row = ctx.sqlite.prepare("SELECT id, name, updated_at FROM playlists WHERE id = ? AND user_id = ?").get(id, userId) as
    | PlaylistRow
    | undefined;
  if (!row) throw new HttpError(404, "Playlist not found.");
  return row;
}

/** The count, length and first album covers, from songs in order (whole songs or just these columns). */
function summarize(row: PlaylistRow, tracks: Array<{ albumId: string; coverHash: string | null; durationSec: number }>): PlaylistSummary {
  const covers: PlaylistSummary["covers"] = [];
  for (const t of tracks) {
    if (covers.length === COVERS) break;
    if (t.coverHash && !covers.some((c) => c.albumId === t.albumId)) covers.push({ albumId: t.albumId, coverHash: t.coverHash });
  }
  return {
    id: row.id,
    name: row.name,
    trackCount: tracks.length,
    durationSec: tracks.reduce((sum, t) => sum + t.durationSec, 0),
    covers,
    updatedAt: row.updated_at,
  };
}

function detail(ctx: AppContext, userId: number, row: PlaylistRow): PlaylistDetail {
  const tracks = tracksByIds(ctx, userId, songIds(ctx, row.id));
  return { ...summarize(row, tracks), tracks };
}

/** Your playlists, the most recently changed first. */
export function listPlaylists(ctx: AppContext, userId: number): PlaylistSummary[] {
  const rows = ctx.sqlite.prepare("SELECT id, name, updated_at FROM playlists WHERE user_id = ? ORDER BY updated_at DESC").all(userId) as PlaylistRow[];
  // Only what the summary needs, not every song's full details.
  const songs = ctx.sqlite.prepare(
    `SELECT t.album_id AS albumId, COALESCE(o.cover_hash, al.cover_hash) AS coverHash, t.duration_sec AS durationSec
     FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id JOIN albums al ON al.id = t.album_id
     LEFT JOIN album_overrides o ON o.album_id = al.id
     WHERE pt.playlist_id = ? AND t.missing_since IS NULL ORDER BY pt.position`,
  );
  return rows.map((r) => summarize(r, songs.all(r.id) as Array<{ albumId: string; coverHash: string | null; durationSec: number }>));
}

export function getPlaylist(ctx: AppContext, userId: number, id: string): PlaylistDetail {
  return detail(ctx, userId, owned(ctx, userId, id));
}

/** Puts exactly these songs in the playlist, in this order; unknown ids and repeats are dropped. */
function writeSongs(ctx: AppContext, playlistId: string, trackIds: string[], now: number) {
  const known = new Set(
    (ctx.sqlite.prepare("SELECT id FROM tracks WHERE id IN (SELECT value FROM json_each(?))").all(JSON.stringify(trackIds)) as Array<{ id: string }>).map(
      (r) => r.id,
    ),
  );
  const ids = [...new Set(trackIds)].filter((id) => known.has(id));
  const added = new Map(
    (ctx.sqlite.prepare("SELECT track_id, added_at FROM playlist_tracks WHERE playlist_id = ?").all(playlistId) as Array<{ track_id: string; added_at: number }>).map(
      (r) => [r.track_id, r.added_at],
    ),
  );
  const ins = ctx.sqlite.prepare("INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)");
  ctx.sqlite.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").run(playlistId);
  ids.forEach((id, i) => ins.run(playlistId, id, i, added.get(id) ?? now));
}

export function createPlaylist(ctx: AppContext, userId: number, name: string, trackIds: string[]): PlaylistDetail {
  const id = newId();
  const now = Date.now();
  ctx.sqlite.transaction(() => {
    ctx.sqlite.prepare("INSERT INTO playlists (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, userId, name, now, now);
    writeSongs(ctx, id, trackIds, now);
  })();
  return getPlaylist(ctx, userId, id);
}

/** Renames, and/or replaces the songs with this list in this order. */
export function updatePlaylist(ctx: AppContext, userId: number, id: string, change: { name?: string; trackIds?: string[] }): PlaylistDetail {
  owned(ctx, userId, id);
  const now = Date.now();
  ctx.sqlite.transaction(() => {
    if (change.name !== undefined) ctx.sqlite.prepare("UPDATE playlists SET name = ? WHERE id = ?").run(change.name, id);
    if (change.trackIds) writeSongs(ctx, id, change.trackIds, now);
    ctx.sqlite.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(now, id);
  })();
  return getPlaylist(ctx, userId, id);
}

/** Adds songs to the end; songs already in it stay where they are. */
export function addToPlaylist(ctx: AppContext, userId: number, id: string, trackIds: string[]): PlaylistDetail {
  owned(ctx, userId, id);
  const current = (ctx.sqlite.prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position").all(id) as Array<{ track_id: string }>).map(
    (r) => r.track_id,
  );
  return updatePlaylist(ctx, userId, id, { trackIds: [...current, ...trackIds] });
}

export function deletePlaylist(ctx: AppContext, userId: number, id: string) {
  owned(ctx, userId, id);
  ctx.sqlite.prepare("DELETE FROM playlists WHERE id = ?").run(id);
  // No foreign key there (ref_id also names albums), so Jump back in's row goes by hand.
  ctx.sqlite.prepare("DELETE FROM recent_sources WHERE kind = 'playlist' AND ref_id = ?").run(id);
}
