import type {
  AlbumCandidate,
  AlbumDetail,
  AlbumMatchApplyInput,
  AlbumMatchField,
  AlbumMatchPreview,
  AlbumMatchProvider,
  AlbumMatchSearch,
  AlbumMatchValues,
  ArtistPhotoOption,
} from "@murmur/shared";
import { apiPaths } from "@murmur/shared";
import sharp from "sharp";
import type { AppContext } from "../context";
import type { Sqlite } from "../db";
import { env } from "../env";
import { HttpError } from "../http";
import { coverMeta, storeCover } from "../library/covers";
import { createLogger, errorMessage } from "../log";
import { createMusicProviders, type AlbumDetail as SourceAlbum, type MusicProviders } from "../metadata/music-providers";
import { cleanArtist, scoreAlbum, searchTitle } from "./match-score";
import { getAlbum } from "./queries";

// Album Match, the same flow as books: search, pick a result, review the fields side by side,
// apply. Applied values go in album_overrides and never touch the files. Artist photos are
// found by name on Deezer, or picked by an admin.

const SUGGEST_AT = 90;
/** Apple is only asked when MusicBrainz and Deezer have nothing this good. */
const FALLBACK_BELOW = 70;
/** MusicBrainz has the original release's details; Deezer and Apple often list a reissue. */
const SOURCE_RANK: Record<AlbumMatchProvider, number> = { musicbrainz: 0, deezer: 1, itunes: 2 };
/** Covers whose original size we don't know are assumed to be this wide. */
const UNKNOWN_COVER_WIDTH = 500;
/** Artists with no photo found are looked up again after this long. */
const RETRY_PHOTO_MS = 30 * 24 * 60 * 60 * 1000;
/** Deezer allows 50 requests in 5 seconds; this stays well under. */
const PHOTO_PAUSE_MS = 250;

const log = createLogger("music-match");

let providers: MusicProviders | null = null;
function getProviders(sqlite: Sqlite): MusicProviders {
  providers ??= createMusicProviders(sqlite, { region: env.audibleRegion, userAgent: `Murmur/${env.version} ( https://github.com/gholaday/murmur )` });
  return providers;
}

async function loadAlbum(ctx: AppContext, albumId: string): Promise<AlbumDetail> {
  const album = await getAlbum(ctx, 0, albumId);
  if (!album) throw new HttpError(404, "Album not found.");
  return album;
}

/** The album as the tags have it, so a match is searched and scored against the files. */
function tagged(ctx: AppContext, albumId: string): { title: string; artist: string } {
  return ctx.sqlite
    .prepare("SELECT a.title, ar.name AS artist FROM albums a JOIN artists ar ON ar.id = a.artist_id WHERE a.id = ?")
    .get(albumId) as { title: string; artist: string };
}

/** Scored results; `query` searches by hand instead of using the album's own details. */
export async function searchAlbumMatches(
  ctx: AppContext,
  albumId: string,
  query: { title?: string; artist?: string },
): Promise<AlbumMatchSearch> {
  const album = await loadAlbum(ctx, albumId);
  const files = tagged(ctx, albumId);
  const p = getProviders(ctx.sqlite);
  const custom = !!(query.title || query.artist);
  const title = query.title?.trim() || searchTitle(files.title);
  const artist = query.artist?.trim() ?? (custom ? "" : files.artist);
  const local = { ...files, trackCount: album.trackCount };
  const errors: string[] = [];

  // Asked together, so either can be down or limiting without losing the other.
  let scored: AlbumCandidate[] = [];
  const sources = [
    { name: "MusicBrainz", search: p.musicbrainzSearch },
    { name: "Deezer", search: p.deezerSearch },
  ];
  const results = await Promise.allSettled(sources.map((s) => s.search(title, artist)));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") scored.push(...r.value.map((c) => scoreAlbum(local, c)));
    else errors.push(`${sources[i]!.name}: ${errorMessage(r.reason)}`);
  });
  if (!scored.some((c) => c.score >= FALLBACK_BELOW)) {
    try {
      scored.push(...(await p.itunesSearch(title, artist)).map((c) => scoreAlbum(local, c)));
    } catch (err) {
      errors.push(`Apple Music: ${errorMessage(err)}`);
    }
  }

  // Highest score first; ties go to the more accurate source, then by id so the order never shuffles.
  scored = scored
    .filter((c) => c.score >= 1)
    .sort((a, b) => b.score - a.score || SOURCE_RANK[a.provider] - SOURCE_RANK[b.provider] || a.providerId.localeCompare(b.providerId))
    .slice(0, 12);
  const top = scored[0];
  return {
    query: { title, artist },
    candidates: scored,
    suggested: top && top.score >= SUGGEST_AT ? `${top.provider}:${top.providerId}` : null,
    errors,
  };
}

async function imageWidth(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return (await sharp(Buffer.from(await res.arrayBuffer()), { failOn: "none" }).metadata()).width ?? null;
  } catch {
    return null;
  }
}

async function detailFor(ctx: AppContext, provider: AlbumMatchProvider, providerId: string): Promise<SourceAlbum> {
  let detail: SourceAlbum | null;
  try {
    detail = await getProviders(ctx.sqlite).albumById(provider, providerId);
  } catch (err) {
    throw new HttpError(502, `Couldn't load that result: ${errorMessage(err)}`);
  }
  if (!detail) throw new HttpError(404, "That result no longer exists.");
  return detail;
}

/** Side-by-side current and proposed values, with what's worth applying ticked. */
export async function previewAlbumMatch(
  ctx: AppContext,
  albumId: string,
  provider: AlbumMatchProvider,
  providerId: string,
): Promise<AlbumMatchPreview> {
  const album = await loadAlbum(ctx, albumId);
  const detail = await detailFor(ctx, provider, providerId);
  const currentCoverWidth = album.coverHash ? ((await coverMeta(env.coversDir, album.coverHash))?.sourceWidth ?? null) : null;
  const proposedCoverWidth = detail.coverUrl ? await imageWidth(detail.coverUrl) : null;

  const current: AlbumMatchValues = {
    title: album.title,
    year: album.year,
    genre: album.genre,
    coverUrl: album.coverHash ? apiPaths.albumCoverUrl(album.id, album.coverHash, 200) : null,
    coverWidth: currentCoverWidth,
  };
  const proposed: AlbumMatchValues = {
    title: detail.title,
    year: detail.year,
    genre: detail.genre,
    // A source can list a cover that isn't there; only one that loaded is offered.
    coverUrl: proposedCoverWidth ? detail.coverUrl : null,
    coverWidth: proposedCoverWidth,
  };

  // Only fill what's missing or poorer; the title is never changed by default.
  const recommended: AlbumMatchField[] = [];
  if (!current.year && proposed.year) recommended.push("year");
  if (!current.genre && proposed.genre) recommended.push("genre");
  if (proposed.coverUrl && proposedCoverWidth && (!album.coverHash || proposedCoverWidth > (currentCoverWidth ?? UNKNOWN_COVER_WIDTH))) {
    recommended.push("cover");
  }
  return { provider, providerId, current, proposed, recommended };
}

interface OverrideRow {
  title: string | null;
  year: string | null;
  genre: string | null;
  cover_hash: string | null;
}

/** Applies the chosen fields (none just marks it matched). Fields not chosen keep any earlier match. */
export async function applyAlbumMatch(ctx: AppContext, albumId: string, input: AlbumMatchApplyInput): Promise<void> {
  await loadAlbum(ctx, albumId);
  const detail = await detailFor(ctx, input.provider, input.providerId);
  const existing = (ctx.sqlite.prepare("SELECT title, year, genre, cover_hash FROM album_overrides WHERE album_id = ?").get(albumId) as
    | OverrideRow
    | undefined) ?? { title: null, year: null, genre: null, cover_hash: null };
  const next: OverrideRow = { ...existing };
  const fields = new Set(input.fields);

  if (fields.has("title") && detail.title) next.title = detail.title;
  if (fields.has("year") && detail.year) next.year = detail.year;
  if (fields.has("genre") && detail.genre) next.genre = detail.genre;
  if (fields.has("cover") && detail.coverUrl) {
    try {
      const res = await fetch(detail.coverUrl, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      next.cover_hash = await storeCover(env.coversDir, Buffer.from(await res.arrayBuffer()));
    } catch (err) {
      throw new HttpError(502, `Couldn't download the cover: ${errorMessage(err)}`);
    }
  }

  ctx.sqlite
    .prepare(
      `INSERT INTO album_overrides (album_id, provider, provider_id, title, year, genre, cover_hash, matched_at)
       VALUES (@albumId, @provider, @providerId, @title, @year, @genre, @cover_hash, @matchedAt)
       ON CONFLICT (album_id) DO UPDATE SET provider = excluded.provider, provider_id = excluded.provider_id,
         title = excluded.title, year = excluded.year, genre = excluded.genre, cover_hash = excluded.cover_hash,
         matched_at = excluded.matched_at`,
    )
    .run({ ...next, albumId, provider: input.provider, providerId: input.providerId, matchedAt: Date.now() });
}

export function removeAlbumMatch(ctx: AppContext, albumId: string) {
  ctx.sqlite.prepare("DELETE FROM album_overrides WHERE album_id = ?").run(albumId);
}

// ---------- Artist photos ----------

function artistOf(ctx: AppContext, artistId: string): { name: string; name_key: string } {
  const row = ctx.sqlite.prepare("SELECT name, name_key FROM artists WHERE id = ?").get(artistId) as { name: string; name_key: string } | undefined;
  if (!row) throw new HttpError(404, "Artist not found.");
  return row;
}

async function downloadPhoto(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`answered ${res.status}`);
  return storeCover(env.coversDir, Buffer.from(await res.arrayBuffer()));
}

function savePhoto(sqlite: Sqlite, nameKey: string, source: "auto" | "chosen" | "none", hash: string | null, providerId: string | null) {
  sqlite
    .prepare(
      `INSERT INTO artist_photos (name_key, source, photo_hash, provider_id, checked_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (name_key) DO UPDATE SET source = excluded.source, photo_hash = excluded.photo_hash,
         provider_id = excluded.provider_id, checked_at = excluded.checked_at`,
    )
    .run(nameKey, source, hash, providerId, Date.now());
}

/** Photos to pick from for an artist, best guess first. */
export async function artistPhotoOptions(ctx: AppContext, artistId: string, query?: string): Promise<ArtistPhotoOption[]> {
  const artist = artistOf(ctx, artistId);
  const current = ctx.sqlite.prepare("SELECT provider_id FROM artist_photos WHERE name_key = ?").get(artist.name_key) as
    | { provider_id: string | null }
    | undefined;
  let hits;
  try {
    hits = await getProviders(ctx.sqlite).deezerArtists(query?.trim() || artist.name);
  } catch (err) {
    throw new HttpError(502, `Deezer ${errorMessage(err)}.`);
  }
  return hits.map((h) => ({ ...h, current: h.providerId === current?.provider_id }));
}

/** Uses the picked photo, or the newest album's cover when `providerId` is null. */
export async function setArtistPhoto(ctx: AppContext, artistId: string, providerId: string | null): Promise<void> {
  const artist = artistOf(ctx, artistId);
  if (providerId === null) {
    // Chosen with no photo: the album cover shows, and it's never looked up again.
    savePhoto(ctx.sqlite, artist.name_key, "chosen", null, null);
    return;
  }
  const hit = await getProviders(ctx.sqlite)
    .deezerArtist(providerId)
    .catch((err: unknown) => {
      throw new HttpError(502, `Deezer ${errorMessage(err)}.`);
    });
  if (!hit) throw new HttpError(404, "That photo no longer exists.");
  try {
    savePhoto(ctx.sqlite, artist.name_key, "chosen", await downloadPhoto(hit.imageUrl), providerId);
  } catch (err) {
    throw new HttpError(502, `Couldn't download the photo: ${errorMessage(err)}`);
  }
}

/**
 * Finds photos for album artists that have none yet, after each music scan. A photo counts
 * only when the names are the same once normalised; with several, the one with the most fans
 * wins. Nothing found is remembered, and tried again after a month.
 */
let fillingPhotos = false;
export async function fillArtistPhotos(sqlite: Sqlite): Promise<void> {
  if (fillingPhotos) return;
  fillingPhotos = true;
  try {
    await fillPhotos(sqlite);
  } finally {
    fillingPhotos = false;
  }
}

async function fillPhotos(sqlite: Sqlite): Promise<void> {
  const pending = sqlite
    .prepare(
      `SELECT DISTINCT ar.name, ar.name_key FROM artists ar JOIN albums a ON a.artist_id = ar.id
       LEFT JOIN artist_photos p ON p.name_key = ar.name_key
       WHERE ar.name_key != 'various artists' AND (p.name_key IS NULL OR (p.source = 'none' AND p.checked_at < ?))`,
    )
    .all(Date.now() - RETRY_PHOTO_MS) as Array<{ name: string; name_key: string }>;
  if (pending.length === 0) return;
  const p = getProviders(sqlite);
  let found = 0;
  for (const artist of pending) {
    try {
      const want = cleanArtist(artist.name);
      const best = (await p.deezerArtists(artist.name)).filter((h) => cleanArtist(h.name) === want).sort((a, b) => b.fans - a.fans)[0];
      if (best) {
        savePhoto(sqlite, artist.name_key, "auto", await downloadPhoto(best.imageUrl), best.providerId);
        found++;
      } else {
        savePhoto(sqlite, artist.name_key, "none", null, null);
      }
    } catch (err) {
      // Offline or limited: stop, and try the rest after the next scan.
      log.warn("artist photo lookup stopped", { artist: artist.name, error: errorMessage(err) });
      break;
    }
    await new Promise((r) => setTimeout(r, PHOTO_PAUSE_MS));
  }
  log.info("artist photos checked", { checked: pending.length, found });
}
