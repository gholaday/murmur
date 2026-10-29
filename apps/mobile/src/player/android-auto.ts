import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import { File, Directory, Paths } from "expo-file-system";
import {
  albumCover,
  albumsByArtist,
  type AlbumDetail,
  type AlbumSort,
  type AlbumSummary,
  apiPaths,
  artistImage,
  type ArtistSummary,
  type MusicSummaryDto,
  type PlaylistDetail,
  type PlaylistSummary,
  plural,
  sortAlbums,
  type TrackDto,
  type UserPrefs,
} from "@murmur/shared/client";
import { absolute, api, authHeaders } from "@/lib/api";
import { keys } from "@/lib/data";
import { queryClient } from "@/lib/query";
import { getJson } from "@/lib/storage";
import { type MusicSource, playMusic } from "./engine";

// Android Auto's browse tree, answered from here (the patched expo-audio asks; see MurmurLibrary
// in patches/expo-audio@58.0.9.patch). "Now playing" is the native side's; Music, with Playlists,
// Albums, Artists and Songs, is the app's own music, shown while the Music tab is. Lists come
// from the saved copies the Music tab uses, so they open offline too, and a picked song plays its
// album, artist, songs or playlist the way the app does: on to the next song, then Up Next.

type Row = { id: string; title: string; subtitle?: string; artwork?: string; browsable?: boolean; playable?: boolean; grid?: boolean };

type AutoModule = {
  addListener(event: "libraryRequest", fn: (e: { requestId: string; parentId: string }) => void): unknown;
  addListener(event: "libraryPlay", fn: (e: { mediaId: string }) => void): unknown;
  answerLibraryRequest(requestId: string, rows: Row[]): void;
  refreshLibrary(parentId: string | null): void;
};

const native = Platform.OS === "android" ? requireOptionalNativeModule<AutoModule>("ExpoAudio") : null;

const ROOT = "murmur-root";
const NOW = "murmur-now";
const MUSIC = "music";
const ALBUMS = "music:albums";
const ARTISTS = "music:artists";
const SONGS = "music:songs";
const PLAYLISTS = "music:playlists";

/** Covers still loading after this are left off the answer and added by a refresh. */
const COVER_WAIT_MS = 2500;

/** The saved copy when there is one (refreshed behind it), else a fetch; nothing when offline. */
async function load<T>(queryKey: readonly unknown[], path: string): Promise<T | undefined> {
  const queryFn = () => api<T>(path);
  const saved = queryClient.getQueryData<T>(queryKey);
  if (saved !== undefined) {
    void queryClient.prefetchQuery({ queryKey, queryFn, staleTime: 60_000 });
    return saved;
  }
  try {
    return await queryClient.fetchQuery({ queryKey, queryFn });
  } catch {
    return undefined;
  }
}

/** Music shows when its tab is on and there's music to browse. */
const showsMusic = (prefs: UserPrefs | undefined, summary: MusicSummaryDto | undefined) => (prefs?.tabs?.music ?? false) && !!summary?.enabled;

const musicOn = async () =>
  showsMusic(...(await Promise.all([load<UserPrefs>(keys.prefs, apiPaths.prefs), load<MusicSummaryDto>(keys.music, apiPaths.music)])));

const myAlbums = async () => sortAlbums((await load<AlbumSummary[]>(keys.albums("mine"), apiPaths.albums("mine", "added"))) ?? [], getJson<AlbumSort>("murmur.albumSort") ?? "added");
const myArtists = async () => (await load<ArtistSummary[]>(keys.artists("mine"), apiPaths.artists("mine"))) ?? [];
const mySongs = async () => (await load<TrackDto[]>(keys.tracks("mine"), apiPaths.tracks("mine"))) ?? [];
const myPlaylists = async () => (await load<PlaylistSummary[]>(keys.playlists, apiPaths.playlists)) ?? [];

// ---------- Covers ----------

const coverDir = () => {
  const dir = new Directory(Paths.cache, "artwork");
  dir.create({ intermediates: true, idempotent: true });
  return dir;
};

/** A cover saved under cache/artwork, which the native side serves to Android Auto. */
const coverFile = (path: string) => new File(coverDir(), `auto-${path.replace(/[^a-zA-Z0-9]+/g, "-")}.img`);

const loading = new Map<string, Promise<void>>();

function fetchCover(path: string): Promise<void> {
  let p = loading.get(path);
  if (!p) {
    const file = coverFile(path);
    p = file.exists
      ? Promise.resolve()
      : File.downloadFileAsync(absolute(path), file, { headers: authHeaders() }).then(
          () => undefined,
          () => undefined,
        );
    loading.set(path, p);
    void p.finally(() => loading.delete(path));
  }
  return p;
}

/**
 * Saves the rows' covers, waiting a little for them. Rows whose cover isn't saved yet go without
 * it, and the folder is refreshed once the rest have arrived.
 */
async function withCovers(parentId: string, rows: (Row & { cover?: string | null })[]): Promise<Row[]> {
  const paths = [...new Set(rows.flatMap((r) => (r.cover ? [r.cover] : [])))];
  const all = Promise.all(paths.map(fetchCover));
  const late = await Promise.race([all.then(() => false), new Promise<boolean>((done) => setTimeout(() => done(true), COVER_WAIT_MS))]);
  if (late) void all.then(() => native?.refreshLibrary(parentId));
  return rows.map(({ cover, ...row }) => {
    const file = cover ? coverFile(cover) : null;
    return file?.exists ? { ...row, artwork: file.uri } : row;
  });
}

// ---------- Folders ----------

const folder = (id: string, title: string, grid = false): Row => ({ id, title, browsable: true, grid });

const songRows = (kind: MusicSource["kind"], ref: string, tracks: TrackDto[]) =>
  tracks.map((t) => ({ id: `play:${kind}:${ref}:${t.id}`, title: t.title, subtitle: t.artist, playable: true, cover: albumCover(t.albumId, t.coverHash) }));

const albumRows = (albums: AlbumSummary[]) =>
  albums.map((a) => ({ id: `album:${a.id}`, title: a.title, subtitle: a.artist, browsable: true, cover: albumCover(a.id, a.coverHash) }));

async function children(parentId: string): Promise<Row[]> {
  if (parentId === ROOT) return [folder(NOW, "Now playing"), ...((await musicOn()) ? [folder(MUSIC, "Music")] : [])];
  // In the Music tab's chip order.
  if (parentId === MUSIC) return [folder(PLAYLISTS, "Playlists", true), folder(ALBUMS, "Albums", true), folder(ARTISTS, "Artists"), folder(SONGS, "Songs")];
  if (parentId === ALBUMS) return withCovers(parentId, albumRows(await myAlbums()));
  if (parentId === ARTISTS) {
    const rows = (await myArtists()).map((a) => ({ id: `artist:${a.id}`, title: a.name, subtitle: plural(a.albumCount, "album"), browsable: true, cover: artistImage(a) }));
    return withCovers(parentId, rows);
  }
  if (parentId === SONGS) return withCovers(parentId, songRows("songs", "", await mySongs()));
  if (parentId === PLAYLISTS) {
    const rows = (await myPlaylists()).map((p) => {
      const first = p.covers[0];
      return { id: `playlist:${p.id}`, title: p.name, subtitle: plural(p.trackCount, "song"), browsable: true, cover: first ? albumCover(first.albumId, first.coverHash) : null };
    });
    return withCovers(parentId, rows);
  }
  const [kind, id] = splitId(parentId);
  if (kind === "album") {
    const a = await load<AlbumDetail>(keys.album(id), apiPaths.album(id));
    return a ? withCovers(parentId, songRows("album", id, a.tracks)) : [];
  }
  if (kind === "artist") {
    // Their albums in your music, as on the Music tab's Artists.
    return withCovers(parentId, albumRows(albumsByArtist(await myAlbums()).get(id) ?? []));
  }
  if (kind === "playlist") {
    const p = await load<PlaylistDetail>(keys.playlist(id), apiPaths.playlist(id));
    return p ? withCovers(parentId, songRows("playlist", id, p.tracks)) : [];
  }
  return [];
}

function splitId(id: string): [string, string] {
  const at = id.indexOf(":");
  return at < 0 ? [id, ""] : [id.slice(0, at), id.slice(at + 1)];
}

/** Where a picked song plays from: its album, the artist, your songs or the playlist. */
async function sourceFor(kind: string, ref: string): Promise<MusicSource | null> {
  if (kind === "album") {
    const a = await load<AlbumDetail>(keys.album(ref), apiPaths.album(ref));
    return a ? { kind, refId: a.id, title: a.title, tracks: a.tracks } : null;
  }
  if (kind === "playlist") {
    const p = await load<PlaylistDetail>(keys.playlist(ref), apiPaths.playlist(ref));
    return p ? { kind, refId: p.id, title: p.name, tracks: p.tracks } : null;
  }
  if (kind === "songs") return { kind, refId: null, title: "Your songs", tracks: await mySongs() };
  return null;
}

async function play(mediaId: string) {
  // play:<kind>:<ref>:<trackId>; ids have no colons of their own.
  const [tag, kind, ref, trackId] = mediaId.split(":");
  if (tag !== "play" || !kind || ref === undefined || !trackId) return;
  const source = await sourceFor(kind, ref);
  const index = source?.tracks.findIndex((t) => t.id === trackId) ?? -1;
  if (source && index >= 0) playMusic(source, index);
}

if (native) {
  native.addListener("libraryRequest", ({ requestId, parentId }) => {
    children(parentId).then(
      (rows) => native.answerLibraryRequest(requestId, rows),
      () => native.answerLibraryRequest(requestId, []),
    );
  });
  native.addListener("libraryPlay", ({ mediaId }) => void play(mediaId));

  // Music comes and goes from the root as its tab is switched, or music appears on the server.
  const cachedMusicOn = () => showsMusic(queryClient.getQueryData<UserPrefs>(keys.prefs), queryClient.getQueryData<MusicSummaryDto>(keys.music));
  let shown = cachedMusicOn();
  queryClient.getQueryCache().subscribe((e) => {
    const key = e.query.queryKey[0];
    if (e.type !== "updated" || (key !== "prefs" && key !== "music")) return;
    const on = cachedMusicOn();
    if (on !== shown) native.refreshLibrary(ROOT);
    shown = on;
  });
}
