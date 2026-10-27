import type { AlbumMatchProvider } from "@murmur/shared";
import type { Sqlite } from "../db";
import type { UnscoredAlbum } from "../music/match-score";
import { cachedJson, ProviderError } from "./providers";

// Lookups for music Match: albums from MusicBrainz (covers from the Cover Art Archive), Deezer
// and Apple; artist photos from Deezer. All free with no key, and every answer goes through
// the same 30-day provider cache as books.

/** MusicBrainz asks for one request a second at most, and answers 503 when it's busy. */
const MUSICBRAINZ_GAP_MS = 1100;
const MUSICBRAINZ_RETRY_MS = 2000;

// Shared through globalThis: Next can load this module more than once.
declare global {
  var __murmurMusicbrainz: { next: number } | undefined;
}
const mbClock = (globalThis.__murmurMusicbrainz ??= { next: 0 });
async function musicbrainzTurn() {
  const now = Date.now();
  const wait = Math.max(0, mbClock.next - now);
  mbClock.next = Math.max(now, mbClock.next) + MUSICBRAINZ_GAP_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

/** Deezer answers 200 with an error in the body; code 4 is its rate limit. */
function deezerError(body: unknown): string | null {
  const err = (body as { error?: { code?: number; message?: string } }).error;
  if (!err) return null;
  return err.code === 4 ? "is limiting how often it can be searched. Try again in a while" : `answered: ${err.message ?? "error"}`;
}

/** Lucene phrase for a MusicBrainz query, with its special characters escaped. */
const phrase = (s: string) => `"${s.replace(/[\\"]/g, "\\$&")}"`;

export interface SourceSong {
  title: string;
  /** Null when the album is one disc or the source doesn't say. */
  discNo: number | null;
  trackNo: number;
  lengthSec: number;
}

export interface AlbumDetail extends UnscoredAlbum {
  /** The songs in play order, when the source lists them. */
  songs: SourceSong[];
}

export interface ArtistHit {
  providerId: string;
  name: string;
  fans: number;
  imageUrl: string;
  thumbUrl: string;
}

interface MbRelease {
  id: string;
  title: string;
  date?: string;
  "track-count"?: number;
  "artist-credit"?: Array<{ name: string; joinphrase?: string }>;
  "release-group"?: { id: string; "first-release-date"?: string };
  media?: Array<{ position?: number; tracks?: Array<{ title?: string; position?: number; length?: number | null }> }>;
  genres?: Array<{ name: string; count: number }>;
  "cover-art-archive"?: { front?: boolean };
}

interface DeezerAlbum {
  id: number;
  title: string;
  cover_medium?: string;
  cover_xl?: string;
  nb_tracks?: number;
  release_date?: string;
  artist?: { name: string };
  genres?: { data?: Array<{ name: string }> };
  tracks?: { data?: Array<{ title?: string; duration?: number }> };
}

interface DeezerArtist {
  id: number;
  name: string;
  nb_fan?: number;
  picture_medium?: string;
  picture_xl?: string;
}

interface ItunesItem {
  wrapperType?: string;
  collectionId?: number;
  collectionName?: string;
  artistName?: string;
  trackCount?: number;
  releaseDate?: string;
  primaryGenreName?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
  trackName?: string;
  trackNumber?: number;
  discNumber?: number;
}

const credit = (r: MbRelease) => (r["artist-credit"] ?? []).map((c) => `${c.name}${c.joinphrase ?? ""}`).join("").trim();

export function createMusicProviders(sqlite: Sqlite, opts: { region: string; userAgent: string }) {
  const get = <T>(url: string) => cachedJson<T>(sqlite, url, opts.userAgent);
  const mb = async <T>(url: string) => {
    const once = () => cachedJson<T>(sqlite, url, opts.userAgent, url, { throttle: musicbrainzTurn });
    try {
      return await once();
    } catch (err) {
      // Busy turns away a share of requests; one more try a little later usually gets through.
      if (!(err instanceof ProviderError) || !err.message.startsWith("isn't answering")) throw err;
      await new Promise((r) => setTimeout(r, MUSICBRAINZ_RETRY_MS));
      return once();
    }
  };
  const deezer = <T>(url: string) => cachedJson<T>(sqlite, url, opts.userAgent, url, { bodyError: deezerError });
  // Apple's store codes match the Audible regions, except the UK.
  const country = opts.region === "uk" ? "gb" : opts.region;

  // ---------- MusicBrainz, covers from the Cover Art Archive ----------

  function mbAlbum(r: MbRelease, cover: string | null): UnscoredAlbum {
    const group = r["release-group"];
    const date = group?.["first-release-date"] || r.date || null;
    const genre = [...(r.genres ?? [])].sort((a, b) => b.count - a.count)[0]?.name ?? null;
    return {
      provider: "musicbrainz",
      providerId: r.id,
      title: r.title,
      artist: credit(r),
      year: date ? date.slice(0, 4) : null,
      genre: genre ? genre.replace(/\b\w/g, (ch) => ch.toUpperCase()) : null,
      trackCount: r["track-count"] ?? r.media?.reduce((n, m) => n + (m.tracks?.length ?? 0), 0) ?? null,
      coverUrl: cover ? `${cover}/front-1200` : null,
      thumbUrl: cover ? `${cover}/front-250` : null,
    };
  }

  async function musicbrainzSearch(title: string, artist: string): Promise<UnscoredAlbum[]> {
    const query = [`release:${phrase(title)}`, artist ? `artist:${phrase(artist)}` : null].filter(Boolean).join(" AND ");
    const qs = new URLSearchParams({ query, fmt: "json", limit: "15" });
    const data = await mb<{ releases?: MbRelease[] }>(`https://musicbrainz.org/ws/2/release/?${qs}`);
    // The same album is often listed once per country; keep one per album and song count.
    const seen = new Set<string>();
    const out: UnscoredAlbum[] = [];
    for (const r of data?.releases ?? []) {
      const key = `${r["release-group"]?.id ?? r.id}:${r["track-count"] ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const group = r["release-group"]?.id;
      out.push(mbAlbum(r, group ? `https://coverartarchive.org/release-group/${group}` : null));
    }
    return out.slice(0, 8);
  }

  async function musicbrainzById(id: string): Promise<AlbumDetail | null> {
    const qs = new URLSearchParams({ inc: "recordings artist-credits release-groups genres", fmt: "json" });
    const r = await mb<MbRelease>(`https://musicbrainz.org/ws/2/release/${encodeURIComponent(id)}?${qs}`);
    if (!r?.title) return null;
    // This release's own front cover, else whichever the album has.
    const group = r["release-group"]?.id;
    const cover = r["cover-art-archive"]?.front
      ? `https://coverartarchive.org/release/${r.id}`
      : group
        ? `https://coverartarchive.org/release-group/${group}`
        : null;
    const media = r.media ?? [];
    const songs = media.flatMap((m, mi) =>
      (m.tracks ?? []).map((t, ti) => ({
        title: t.title ?? "",
        discNo: media.length > 1 ? (m.position ?? mi + 1) : null,
        trackNo: t.position ?? ti + 1,
        lengthSec: (t.length ?? 0) / 1000,
      })),
    );
    // Genres are mostly tagged on the album as a whole rather than on each release of it.
    if (!r.genres?.length && group) {
      const g = await mb<{ genres?: MbRelease["genres"] }>(`https://musicbrainz.org/ws/2/release-group/${group}?inc=genres&fmt=json`);
      r.genres = g?.genres;
    }
    return { ...mbAlbum(r, cover), songs };
  }

  // ---------- Deezer: albums, and the only free source of artist photos ----------

  function deezerAlbum(a: DeezerAlbum): UnscoredAlbum {
    return {
      provider: "deezer",
      providerId: String(a.id),
      title: a.title,
      artist: a.artist?.name ?? "",
      year: a.release_date ? a.release_date.slice(0, 4) : null,
      genre: a.genres?.data?.[0]?.name ?? null,
      trackCount: a.nb_tracks ?? null,
      coverUrl: a.cover_xl ?? null,
      thumbUrl: a.cover_medium ?? null,
    };
  }

  async function deezerSearch(title: string, artist: string): Promise<UnscoredAlbum[]> {
    const run = async (q: string) => {
      const data = await deezer<{ data?: DeezerAlbum[] }>(`https://api.deezer.com/search/album?${new URLSearchParams({ q, limit: "10" })}`);
      return (data?.data ?? []).filter((a) => a.title).map(deezerAlbum);
    };
    const exact = artist ? await run(`artist:${phrase(artist)} album:${phrase(title)}`) : [];
    return exact.length ? exact : run([artist, title].filter(Boolean).join(" "));
  }

  async function deezerById(id: string): Promise<AlbumDetail | null> {
    const a = await deezer<DeezerAlbum>(`https://api.deezer.com/album/${encodeURIComponent(id)}`);
    if (!a?.title) return null;
    // Deezer lists the songs in order but not their disc.
    const songs = (a.tracks?.data ?? []).map((t, i) => ({ title: t.title ?? "", discNo: null, trackNo: i + 1, lengthSec: t.duration ?? 0 }));
    return { ...deezerAlbum(a), songs };
  }

  /** Deezer's link for an artist with no picture has an empty image id. */
  const hasPicture = (url: string | undefined): url is string => !!url && !url.includes("/artist//");

  async function deezerArtists(name: string): Promise<ArtistHit[]> {
    const data = await deezer<{ data?: DeezerArtist[] }>(`https://api.deezer.com/search/artist?${new URLSearchParams({ q: name, limit: "10" })}`);
    return (data?.data ?? [])
      .filter((a) => hasPicture(a.picture_xl) && hasPicture(a.picture_medium))
      .map((a) => ({ providerId: String(a.id), name: a.name, fans: a.nb_fan ?? 0, imageUrl: a.picture_xl!, thumbUrl: a.picture_medium! }));
  }

  async function deezerArtist(id: string): Promise<ArtistHit | null> {
    const a = await deezer<DeezerArtist>(`https://api.deezer.com/artist/${encodeURIComponent(id)}`);
    if (!a?.name || !hasPicture(a.picture_xl) || !hasPicture(a.picture_medium)) return null;
    return { providerId: String(a.id), name: a.name, fans: a.nb_fan ?? 0, imageUrl: a.picture_xl, thumbUrl: a.picture_medium };
  }

  // ---------- Apple (iTunes Search) ----------

  function itunesAlbum(a: ItunesItem): UnscoredAlbum {
    // The artwork link names its size; Apple serves the same image at any size up to the original.
    const art = a.artworkUrl100;
    return {
      provider: "itunes",
      providerId: String(a.collectionId),
      title: a.collectionName ?? "",
      artist: a.artistName ?? "",
      year: a.releaseDate ? a.releaseDate.slice(0, 4) : null,
      genre: a.primaryGenreName ?? null,
      trackCount: a.trackCount ?? null,
      coverUrl: art ? art.replace(/\/100x100bb\./, "/1400x1400bb.") : null,
      thumbUrl: art ? art.replace(/\/100x100bb\./, "/200x200bb.") : null,
    };
  }

  async function itunesSearch(title: string, artist: string): Promise<UnscoredAlbum[]> {
    const qs = new URLSearchParams({ term: [artist, title].filter(Boolean).join(" "), media: "music", entity: "album", country, limit: "10" });
    const data = await get<{ results?: ItunesItem[] }>(`https://itunes.apple.com/search?${qs}`);
    return (data?.results ?? []).filter((a) => a.collectionId && a.collectionName).map(itunesAlbum);
  }

  async function itunesById(id: string): Promise<AlbumDetail | null> {
    const qs = new URLSearchParams({ id, entity: "song", country });
    const data = await get<{ results?: ItunesItem[] }>(`https://itunes.apple.com/lookup?${qs}`);
    const results = data?.results ?? [];
    const album = results.find((r) => r.wrapperType === "collection" && String(r.collectionId) === id);
    if (!album?.collectionName) return null;
    const items = results.filter((r) => r.wrapperType === "track");
    const multiDisc = items.some((s) => (s.discNumber ?? 1) > 1);
    const songs = items
      .sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
      .map((s, i) => ({
        title: s.trackName ?? "",
        discNo: multiDisc ? (s.discNumber ?? 1) : null,
        trackNo: s.trackNumber ?? i + 1,
        lengthSec: (s.trackTimeMillis ?? 0) / 1000,
      }));
    return { ...itunesAlbum(album), songs };
  }

  async function albumById(provider: AlbumMatchProvider, id: string): Promise<AlbumDetail | null> {
    if (provider === "musicbrainz") return musicbrainzById(id);
    if (provider === "deezer") return deezerById(id);
    return itunesById(id);
  }

  return { musicbrainzSearch, deezerSearch, itunesSearch, albumById, deezerArtists, deezerArtist };
}

export type MusicProviders = ReturnType<typeof createMusicProviders>;
export { ProviderError };
