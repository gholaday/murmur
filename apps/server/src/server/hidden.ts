// What each person hid (hidden_items). Lists, shelves and Android Auto drop hidden things through
// `hiddenFor` and the filters below; search leaves them out in SQL with the HIDDEN_* fragments.
// Downloads and stats keep them. Hiding an artist hides their albums, and the songs on them.
import {
  apiPaths,
  type AlbumSummary,
  type ArtistDetail,
  type ArtistSummary,
  type MovieDetail,
  type BookSummary,
  type HiddenChange,
  type HiddenDto,
  type HiddenItem,
  type HiddenKind,
  HIDDEN_SECTION,
  artistImage,
  albumCover,
  type MusicHomeDto,
  plural,
  type TrackDto,
  type WatchHomeDto,
} from "@murmur/shared";
import type { AppContext } from "./context";
import { coverColors } from "./library/covers";

/** Ids of what @user hid; `albums` includes every album by a hidden artist. */
export interface Hidden {
  books: Set<string>;
  albums: Set<string>;
  artists: Set<string>;
  movies: Set<string>;
  shows: Set<string>;
  /** Albums hidden on their own, counted by their artist, so an artist's album count leaves them out. */
  albumsByArtist: Map<string, number>;
}

export function hiddenFor(ctx: AppContext, userId: number): Hidden {
  const rows = ctx.sqlite.prepare("SELECT kind, item_id FROM hidden_items WHERE user_id = ?").all(userId) as Array<{
    kind: HiddenKind;
    item_id: string;
  }>;
  const of = (kind: HiddenKind) => rows.filter((r) => r.kind === kind).map((r) => r.item_id);
  const artistKeys = of("artist");
  const artists = artistKeys.length
    ? (ctx.sqlite.prepare("SELECT id FROM artists WHERE name_key IN (SELECT value FROM json_each(?))").all(JSON.stringify(artistKeys)) as Array<{ id: string }>).map(
        (r) => r.id,
      )
    : [];
  const artistAlbums = artists.length
    ? (ctx.sqlite.prepare("SELECT id FROM albums WHERE artist_id IN (SELECT value FROM json_each(?))").all(JSON.stringify(artists)) as Array<{ id: string }>).map(
        (r) => r.id,
      )
    : [];
  const ownAlbums = of("album");
  const albumsByArtist = new Map(
    ownAlbums.length
      ? (
          ctx.sqlite
            .prepare("SELECT artist_id AS artist, COUNT(*) AS n FROM albums WHERE id IN (SELECT value FROM json_each(?)) GROUP BY artist_id")
            .all(JSON.stringify(ownAlbums)) as Array<{ artist: string; n: number }>
        ).map((r) => [r.artist, r.n] as const)
      : [],
  );
  return {
    albumsByArtist,
    books: new Set(of("book")),
    albums: new Set([...ownAlbums, ...artistAlbums]),
    artists: new Set(artists),
    movies: new Set(of("movie")),
    shows: new Set(of("show")),
  };
}

export const withoutIds = <T extends { id: string }>(list: T[], ids: Set<string>) => (ids.size ? list.filter((x) => !ids.has(x.id)) : list);
export const visibleBooks = (list: BookSummary[], h: Hidden) => withoutIds(list, h.books);
export const visibleAlbums = (list: AlbumSummary[], h: Hidden) => list.filter((a) => !h.albums.has(a.id) && !h.artists.has(a.artistId));
/** Artists you didn't hide, counting only albums you didn't; one with every album hidden goes too. */
export function visibleArtists<A extends ArtistSummary>(list: A[], h: Hidden): A[] {
  return withoutIds(list, h.artists).flatMap((a) => {
    const gone = h.albumsByArtist.get(a.id) ?? 0;
    if (!gone) return [a];
    return a.albumCount > gone ? [{ ...a, albumCount: a.albumCount - gone }] : [];
  });
}
/** A song goes with its album, and with its own artist. */
export const visibleTracks = (list: TrackDto[], h: Hidden) => list.filter((t) => !h.albums.has(t.albumId) && !h.artists.has(t.artistId));
/** An artist's page without what you hid; the page itself still opens (Up Next, stats and links reach it). */
export const visibleArtist = (a: ArtistDetail, h: Hidden): ArtistDetail => ({
  ...a,
  albums: visibleAlbums(a.albums, h),
  appearsOn: visibleTracks(a.appearsOn, h),
});
/** A movie's Collection and More like this shelves without the movies you hid. */
export function visibleMovie(m: MovieDetail, h: Hidden): MovieDetail {
  if (!h.movies.size) return m;
  const shown = <T extends { id: string }>(items: T[]) => items.filter((i) => i.id === m.id || !h.movies.has(i.id));
  const collection = m.collection && { ...m.collection, items: shown(m.collection.items) };
  return { ...m, collection: collection && collection.items.length > 1 ? collection : null, similar: m.similar && shown(m.similar) };
}
/** Watch cards and posters: an episode goes with its show. */
export function visibleWatch<T extends { kind: "movie" | "show" | "episode"; id: string; showId?: string | null }>(list: T[], h: Hidden): T[] {
  return list.filter((w) => (w.kind === "movie" ? !h.movies.has(w.id) : !h.shows.has(w.kind === "show" ? w.id : (w.showId ?? ""))));
}

export function visibleWatchHome(home: WatchHomeDto, h: Hidden): WatchHomeDto {
  return {
    ...home,
    continueWatching: visibleWatch(home.continueWatching, h),
    nextEpisodes: visibleWatch(home.nextEpisodes, h),
    nextInCollection: home.nextInCollection && visibleWatch(home.nextInCollection, h),
    moreLike: home.moreLike && { ...home.moreLike, items: visibleWatch(home.moreLike.items, h) },
    recentlyAdded: visibleWatch(home.recentlyAdded, h),
  };
}

export function visibleMusicHome(home: MusicHomeDto, h: Hidden): MusicHomeDto {
  return {
    ...home,
    jumpBackIn: home.jumpBackIn.filter((j) => j.kind !== "album" || visibleAlbums([j.album], h).length),
    onRepeat: visibleTracks(home.onRepeat, h),
    moreLikeAlbum: home.moreLikeAlbum && { ...home.moreLikeAlbum, items: visibleAlbums(home.moreLikeAlbum.items, h) },
    moreLikeArtist: home.moreLikeArtist && { ...home.moreLikeArtist, items: visibleArtists(home.moreLikeArtist.items, h) },
    newAlbums: visibleAlbums(home.newAlbums, h),
  };
}

// ---------- In SQL, for search (takes @user) ----------

const HIDDEN = (kind: HiddenKind, id: string) =>
  `EXISTS (SELECT 1 FROM hidden_items h WHERE h.user_id = @user AND h.kind = '${kind}' AND h.item_id = ${id})`;
/** Artists are hidden by name key, which outlives the artist row. */
const HIDDEN_ARTIST = (artistId: string) =>
  `EXISTS (SELECT 1 FROM hidden_items h JOIN artists ha ON ha.name_key = h.item_id WHERE h.user_id = @user AND h.kind = 'artist' AND ha.id = ${artistId})`;
const HIDDEN_ALBUM = (albumId: string) => `(${HIDDEN("album", albumId)} OR ${HIDDEN_ARTIST(`(SELECT artist_id FROM albums WHERE id = ${albumId})`)})`;

/** Search index kinds, with `ref` its id: when it's hidden. */
export const HIDDEN_SQL: Record<"book" | "artist" | "album" | "track" | "movie" | "show" | "video", (ref: string) => string> = {
  book: (ref) => HIDDEN("book", ref),
  artist: HIDDEN_ARTIST,
  album: HIDDEN_ALBUM,
  track: (ref) =>
    `EXISTS (SELECT 1 FROM tracks ht WHERE ht.id = ${ref} AND (${HIDDEN_ALBUM("ht.album_id")} OR ${HIDDEN_ARTIST("ht.artist_id")}))`,
  movie: (ref) => HIDDEN("movie", ref),
  show: (ref) => HIDDEN("show", ref),
  video: (ref) => `EXISTS (SELECT 1 FROM videos hv WHERE hv.id = ${ref} AND ${HIDDEN("show", "hv.show_id")})`,
};

// ---------- Hiding and unhiding ----------

/** The key a row is saved under: an artist's name key, else the id. Null when it isn't here. */
function itemKey(ctx: AppContext, change: HiddenChange): string | null {
  if (change.kind !== "artist") return change.id;
  const row = ctx.sqlite.prepare("SELECT name_key FROM artists WHERE id = ?").get(change.id) as { name_key: string } | undefined;
  return row?.name_key ?? null;
}

export function hide(ctx: AppContext, userId: number, change: HiddenChange): void {
  const key = itemKey(ctx, change);
  if (!key) return;
  ctx.sqlite
    .prepare("INSERT INTO hidden_items (user_id, kind, item_id, hidden_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
    .run(userId, change.kind, key, Date.now());
}

export function unhide(ctx: AppContext, userId: number, change: HiddenChange): void {
  const key = itemKey(ctx, change);
  if (!key) return;
  ctx.sqlite.prepare("DELETE FROM hidden_items WHERE user_id = ? AND kind = ? AND item_id = ?").run(userId, change.kind, key);
}

interface HiddenRow {
  kind: HiddenKind;
  id: string;
  title: string;
  sub: string;
  hash: string | null;
  /** Artists: the album its cover comes from. */
  ref: string | null;
  photo: string | null;
  hidden_at: number;
}

/**
 * You > Hidden: everything you hid that's still on the server, by section, newest first. Each
 * row is built in SQL with its title, sub line and picture.
 */
export async function listHidden(ctx: AppContext, userId: number): Promise<HiddenDto> {
  const rows = ctx.sqlite
    .prepare(
      `SELECT h.kind, b.id, COALESCE(o.title, b.title) AS title, COALESCE(NULLIF(COALESCE(o.author, b.author), ''), '') AS sub,
              COALESCE(o.cover_hash, b.cover_hash) AS hash, NULL AS ref, NULL AS photo, h.hidden_at
       FROM hidden_items h JOIN books b ON b.id = h.item_id LEFT JOIN book_overrides o ON o.book_id = b.id
       WHERE h.user_id = @user AND h.kind = 'book'
       UNION ALL
       SELECT h.kind, al.id, COALESCE(ao.title, al.title), 'Album, ' || ar.name, COALESCE(ao.cover_hash, al.cover_hash), NULL, NULL, h.hidden_at
       FROM hidden_items h JOIN albums al ON al.id = h.item_id JOIN artists ar ON ar.id = al.artist_id
       LEFT JOIN album_overrides ao ON ao.album_id = al.id
       WHERE h.user_id = @user AND h.kind = 'album'
       UNION ALL
       SELECT h.kind, ar.id, ar.name, CAST((SELECT COUNT(*) FROM albums a WHERE a.artist_id = ar.id) AS TEXT),
              (SELECT COALESCE(ao.cover_hash, a.cover_hash) FROM albums a LEFT JOIN album_overrides ao ON ao.album_id = a.id
               WHERE a.artist_id = ar.id AND COALESCE(ao.cover_hash, a.cover_hash) IS NOT NULL LIMIT 1),
              (SELECT a.id FROM albums a LEFT JOIN album_overrides ao ON ao.album_id = a.id
               WHERE a.artist_id = ar.id AND COALESCE(ao.cover_hash, a.cover_hash) IS NOT NULL LIMIT 1),
              p.photo_hash, h.hidden_at
       FROM hidden_items h JOIN artists ar ON ar.name_key = h.item_id LEFT JOIN artist_photos p ON p.name_key = ar.name_key
       WHERE h.user_id = @user AND h.kind = 'artist'
       UNION ALL
       SELECT h.kind, m.id, m.title, COALESCE(m.year, ''), m.poster_hash, NULL, NULL, h.hidden_at
       FROM hidden_items h JOIN movies m ON m.id = h.item_id
       WHERE h.user_id = @user AND h.kind = 'movie'
       UNION ALL
       SELECT h.kind, s.id, s.title, CAST((SELECT COUNT(DISTINCT v.season) FROM videos v WHERE v.show_id = s.id) AS TEXT),
              s.poster_hash, NULL, NULL, h.hidden_at
       FROM hidden_items h JOIN shows s ON s.id = h.item_id
       WHERE h.user_id = @user AND h.kind = 'show'
       ORDER BY hidden_at DESC`,
    )
    .all({ user: userId }) as HiddenRow[];
  const colors = await coverColors(rows.filter((r) => r.kind === "book" || r.kind === "album" || r.kind === "artist").map((r) => r.hash));
  const out: HiddenDto = { books: [], music: [], watch: [] };
  for (const r of rows) out[HIDDEN_SECTION[r.kind]].push(toItem(r, colors));
  return out;
}

function toItem(r: HiddenRow, colors: Map<string, string>): HiddenItem {
  const color = r.hash ? (colors.get(r.hash) ?? null) : null;
  const base = { kind: r.kind, id: r.id, title: r.title, color, hiddenAt: r.hidden_at };
  switch (r.kind) {
    case "book":
      return { ...base, sub: r.sub, image: r.hash ? apiPaths.coverUrl(r.id, r.hash, 200) : null };
    case "album":
      return { ...base, sub: r.sub, image: albumCover(r.id, r.hash) };
    case "artist":
      return {
        ...base,
        sub: `Artist, ${plural(Number(r.sub), "album")}`,
        image: artistImage({ id: r.id, name: r.title, albumCount: 0, trackCount: 0, photoHash: r.photo, coverAlbumId: r.ref, coverHash: r.hash }),
      };
    case "movie":
      return { ...base, sub: r.sub ? `Movie, ${r.sub}` : "Movie", image: r.hash ? apiPaths.movieArtUrl(r.id, "poster", r.hash, "small") : null };
    case "show":
      return { ...base, sub: `Show, ${plural(Number(r.sub), "season")}`, image: r.hash ? apiPaths.showArtUrl(r.id, "poster", r.hash, "small") : null };
  }
}
