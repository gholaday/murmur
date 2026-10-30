import type { AlbumSummary, JumpBackItem, MusicHomeDto, PlaylistSummary } from "@murmur/shared";
import { flatKeys, NEW_ALBUM_DAYS, ON_REPEAT_DAYS, rankSimilar, SHELF_SIZE } from "@murmur/shared";
import type { AppContext } from "../context";
import { shelf } from "../shelf";
import { listPlaylists } from "./playlists";
import { albumGenres, albumsByIds, artistsByIds, listNewAlbums, tracksByIds } from "./queries";

/** How far back Jump back in looks before it has enough. */
const RECENT_ROWS = 40;
/** On repeat leaves out songs only skipped past. */
const ON_REPEAT_MIN_SEC = 60;
/** On repeat sends this many: Home shows the top few, and picking one queues them all. */
const ON_REPEAT_SIZE = 25;
const MORE_LIKE_SIZE = 12;

/** The Music Home chip: each shelf built on its own, so one that fails just comes back empty. */
export async function musicHome(ctx: AppContext, userId: number, playlists?: PlaylistSummary[]): Promise<MusicHomeDto> {
  const [jumpBackIn, onRepeat, newAlbums] = await Promise.all([
    shelf("jump back in", () => jumpBack(ctx, userId, playlists), [] as JumpBackItem[]),
    shelf("on repeat", () => onRepeatTracks(ctx, userId), []),
    shelf("new albums", () => listNewAlbums(ctx, userId, Date.now() - NEW_ALBUM_DAYS * 86_400_000), [] as AlbumSummary[]),
  ]);
  const { moreLikeAlbum, moreLikeArtist } = await shelf("more like", () => moreLike(ctx, userId, jumpBackIn), {
    moreLikeAlbum: null,
    moreLikeArtist: null,
  });
  return { jumpBackIn, onRepeat, moreLikeAlbum, moreLikeArtist, newAlbums };
}

/**
 * About the last album you played (the first album in Jump back in). More like its artist: other
 * artists ranked by shared genres. More like the album: the artist's other albums, then albums of
 * the same genre by artists not in the artist shelf, leaving out Jump back in's. No overlap.
 */
async function moreLike(ctx: AppContext, userId: number, jumpBackIn: JumpBackItem[]): Promise<Pick<MusicHomeDto, "moreLikeAlbum" | "moreLikeArtist">> {
  const source = jumpBackIn.find((i) => i.kind === "album")?.album;
  if (!source) return { moreLikeAlbum: null, moreLikeArtist: null };
  // Ranked on a lean read of every album (id, artist, genre); only the picks get full summaries.
  const all = albumGenres(ctx);
  const genreOf = (a: { genre: string | null }) => a.genre?.trim().toLowerCase() || null;
  const skip = new Set(jumpBackIn.flatMap((i) => (i.kind === "album" ? [i.album.id] : [])));
  // Artists first: an artist's genres are their albums', and rarer ones count for more.
  const artistsById = new Map<string, { id: string; title: string; genres: Set<string> }>();
  for (const a of all) {
    const entry = artistsById.get(a.artistId) ?? { id: a.artistId, title: a.artist, genres: new Set<string>() };
    const g = genreOf(a);
    if (g) entry.genres.add(g);
    artistsById.set(a.artistId, entry);
  }
  const asItem = (a: { id: string; title: string; genres: Set<string> }) => ({ id: a.id, title: a.title, keys: flatKeys([...a.genres]) });
  const sourceArtist = artistsById.get(source.artistId);
  const rankedIds = sourceArtist
    ? rankSimilar(asItem(sourceArtist), [...artistsById.values()].map(asItem))
        .map((r) => r.id)
        .slice(0, MORE_LIKE_SIZE)
    : [];
  const ranked = artistsByIds(ctx, userId, rankedIds);

  // Then albums: the artist's others, then the genre's, from artists not already in the artist shelf.
  const shown = new Set(rankedIds);
  const others = all.filter((a) => a.id !== source.id && !skip.has(a.id));
  const sameArtist = others.filter((a) => a.artistId === source.artistId);
  const sameGenre = genreOf(source)
    ? others.filter((a) => a.artistId !== source.artistId && !shown.has(a.artistId) && genreOf(a) === genreOf(source))
    : [];
  const pickIds = [...sameArtist, ...sameGenre].slice(0, MORE_LIKE_SIZE).map((a) => a.id);
  const byId = new Map((await albumsByIds(ctx, userId, pickIds)).map((a) => [a.id, a]));
  const albums = pickIds.flatMap((id) => byId.get(id) ?? []);

  return {
    moreLikeAlbum: albums.length ? { title: `More like ${source.title}`, items: albums } : null,
    moreLikeArtist: ranked.length ? { title: `More like ${source.artist}`, items: ranked } : null,
  };
}

/**
 * Albums and playlists you played from, most recent first. Song plays from before any source was
 * recorded fill in by album, so a playlist play doesn't also bring back its songs' albums.
 * Deleted albums and playlists drop out here.
 */
async function jumpBack(ctx: AppContext, userId: number, loaded?: PlaylistSummary[]): Promise<JumpBackItem[]> {
  const recent = ctx.sqlite
    .prepare(
      `SELECT kind, ref_id, last_played_at FROM recent_sources WHERE user_id = ?
       UNION ALL
       SELECT 'album', t.album_id, MAX(p.last_played_at) AS last_played_at FROM track_plays p JOIN tracks t ON t.id = p.track_id
       WHERE p.user_id = ? AND p.last_played_at < COALESCE((SELECT MIN(last_played_at) FROM recent_sources WHERE user_id = ?), 9e15)
       GROUP BY t.album_id
       ORDER BY last_played_at DESC LIMIT ${RECENT_ROWS * 2}`,
    )
    .all(userId, userId, userId) as Array<{ kind: "album" | "playlist"; ref_id: string; last_played_at: number }>;
  const seen = new Set<string>();
  const order = recent.filter((r) => {
    const key = `${r.kind}:${r.ref_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const albums = new Map((await albumsByIds(ctx, userId, order.filter((r) => r.kind === "album").map((r) => r.ref_id))).map((a) => [a.id, a]));
  // The music page has already summed up your playlists; the API asks here.
  const playlists = new Map((loaded ?? listPlaylists(ctx, userId)).map((p) => [p.id, p]));
  const items: JumpBackItem[] = [];
  for (const r of order) {
    if (items.length === SHELF_SIZE) break;
    const album = r.kind === "album" ? albums.get(r.ref_id) : undefined;
    const playlist = r.kind === "playlist" ? playlists.get(r.ref_id) : undefined;
    if (album) items.push({ kind: "album", album });
    else if (playlist && playlist.trackCount > 0) items.push({ kind: "playlist", playlist });
  }
  return items;
}

/** The songs you listened to longest over the last month, on any device. */
function onRepeatTracks(ctx: AppContext, userId: number) {
  const since = new Date(Date.now() - ON_REPEAT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const ids = (
    ctx.sqlite
      .prepare(
        `SELECT item_id FROM listening_days WHERE user_id = ? AND item_type = 'track' AND day >= ?
         GROUP BY item_id HAVING SUM(listened_sec) >= ${ON_REPEAT_MIN_SEC}
         ORDER BY SUM(listened_sec) DESC LIMIT ${ON_REPEAT_SIZE}`,
      )
      .all(userId, since) as Array<{ item_id: string }>
  ).map((r) => r.item_id);
  return tracksByIds(ctx, userId, ids);
}
