import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  type AlbumDetail,
  type AlbumSummary,
  apiPaths,
  type ArtistDetail,
  type ArtistSummary,
  type LikedMusicDto,
  type MusicLikeChange,
  type MusicHomeDto,
  type SearchResultsDto,
  type MusicSummaryDto,
  type PlaylistDetail,
  type PlaylistSummary,
  type TrackDto,
  type BookDetail,
  type BookSection,
  bookSections,
  type BookSummary,
  type EpisodeDto,
  type EpisodeWithShow,
  type PodcastDetail,
  type PodcastSummary,
  type ProgressItem,
  type UserPrefs,
  type UserPrefsPatch,
  type VideoQuality,
  type BulkEditForm,
  EPISODE_PAGE,
  errorText,
  type OpmlImportResult,
  plural,
} from "@murmur/shared/client";
import { File } from "expo-file-system";
import { toast } from "@/components/toast";
import { absolute, api, authHeaders, HttpError } from "./api";
import { queryClient } from "./query";
import { keys } from "./query-keys";

export { keys };

// Your own settings (Books tab layout, which tabs show), saved on the server so the web and the
// app share them. Until they load, or on a server without them, the defaults apply.
const prefsQuery = { queryKey: keys.prefs, queryFn: () => api<UserPrefs>(apiPaths.prefs) };
const usePrefs = () => useQuery(prefsQuery);

/** Your prefs, sharing a request with any screen asking at the same moment. */
export const fetchPrefs = () => queryClient.fetchQuery(prefsQuery);

export function useBookSections(): BookSection[] {
  return bookSections(usePrefs().data?.bookSections);
}

/** Optional tabs: Books and Podcasts are on and Music and Watch are off until you switch them. */
export function useTabPrefs(): Required<UserPrefs["tabs"]> {
  const tabs = usePrefs().data?.tabs;
  return { books: tabs?.books ?? true, podcasts: tabs?.podcasts ?? true, music: tabs?.music ?? false, watch: tabs?.watch ?? false };
}

/**
 * Whether the first-run steps show: only once prefs say this account hasn't been through them.
 * Older accounts and servers count as done. `waiting` holds the tabs back until prefs are known,
 * unless the request is paused offline.
 */
export function useOnboarding(): { show: boolean; waiting: boolean } {
  const prefs = usePrefs();
  return { show: prefs.data?.onboarded === false, waiting: prefs.isPending && prefs.fetchStatus === "fetching" };
}

/** Marks the first-run steps done, so they don't come back. Throws what went wrong. */
export async function finishOnboarding() {
  const saved = await api<UserPrefs>(apiPaths.prefs, { method: "PUT", body: { onboarded: true } });
  queryClient.setQueryData(keys.prefs, saved);
}

/** Picks an OPML file (another podcast app's export) and follows its shows, saying how it went. */
export async function importOpml() {
  // OPML files rarely say what they are, so any file can be picked.
  const picked = await File.pickFileAsync({ mimeTypes: "*/*" });
  if (picked.canceled) return;
  toast.show("Importing. Large lists can take a minute.", { duration: 60_000 });
  try {
    const res = await fetch(absolute(apiPaths.podcastsOpml), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "text/xml" },
      body: await picked.result.text(),
    });
    const data = (await res.json().catch(() => ({ error: `Import failed (${res.status}).` }))) as OpmlImportResult | { error: string };
    if (!res.ok || "error" in data) throw new Error("error" in data ? data.error : "Import failed.");
    const failed = data.failed.length ? ` ${data.failed.length} couldn't be loaded.` : "";
    const text = `Added ${plural(data.added, "podcast")}, ${data.alreadySubscribed} already followed.${failed}`;
    if (data.failed.length) toast.error(text);
    else toast.show(text);
    if (data.added) void queryClient.invalidateQueries({ queryKey: keys.podcasts });
  } catch (err) {
    toast.error(errorText(err, "Import failed."));
  }
}

/** Saves a change, showing it at once; puts the old prefs back if the server says no. */
function savePrefs(patch: UserPrefsPatch, failed: string, onSaved?: () => void) {
  const previous = queryClient.getQueryData<UserPrefs>(keys.prefs);
  if (previous) queryClient.setQueryData<UserPrefs>(keys.prefs, { ...previous, ...patch } as UserPrefs);
  api<UserPrefs>(apiPaths.prefs, { method: "PUT", body: patch })
    .then((saved) => {
      queryClient.setQueryData(keys.prefs, saved);
      onSaved?.();
    })
    .catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : failed);
      if (previous) queryClient.setQueryData(keys.prefs, previous);
      else void queryClient.resetQueries({ queryKey: keys.prefs });
    });
}

/** Whether Browse's charts and suggestions include explicit shows; undefined on a server from before Browse. */
export const useExplicitShows = (): boolean | undefined => usePrefs().data?.explicitShows;

/** Browse's lists come back without (or with) explicit shows once it's saved. */
export const saveExplicitShows = (on: boolean) =>
  savePrefs({ explicitShows: on }, "Couldn't save that.", () => void queryClient.invalidateQueries({ queryKey: keys.podcastDirectory }));

export const saveBookSections = (next: BookSection[]) => savePrefs({ bookSections: next }, "Couldn't save the layout.");

export const saveTabPrefs = (tabs: UserPrefs["tabs"]) => savePrefs({ tabs }, "Couldn't save the tabs.");

/** The quality the server converts video at; full until your prefs load. */
export const useVideoQuality = (): VideoQuality => usePrefs().data?.videoQuality ?? "full";

/** The same, for the player, loading your prefs if nothing has yet. */
export async function readVideoQuality(): Promise<VideoQuality> {
  try {
    return (await fetchPrefs()).videoQuality ?? "full";
  } catch {
    return "full";
  }
}

/** Whether the next episode starts on its own when one ends; on until your prefs say otherwise. */
export const useAutoplayNext = (): boolean => usePrefs().data?.autoplayNext ?? true;

export const saveAutoplayNext = (autoplayNext: boolean) => savePrefs({ autoplayNext }, "Couldn't save that.");

export const saveVideoQuality =(videoQuality: VideoQuality) => savePrefs({ videoQuality }, "Couldn't save the quality.");

export const useBooks = () => useQuery({ queryKey: keys.books, queryFn: () => api<BookSummary[]>(apiPaths.books) });

export const useBook = (id: string) =>
  useQuery({ queryKey: keys.book(id), queryFn: () => api<BookDetail>(apiPaths.book(id)) });

/** Whether the server has music; everything about music hides until it says so. */
export const useMusicSummary = () => useQuery({ queryKey: keys.music, queryFn: () => api<MusicSummaryDto>(apiPaths.music) });

/** For a feature newer than the server: a 404 means it doesn't have it, and the answer is null. */
export function nullIfMissing(err: unknown): null {
  if (err instanceof HttpError && err.status === 404) return null;
  throw err;
}

/** The Home chip's shelves: Jump back in, On repeat and New albums. Null on a server from before Home. */
export const useMusicHome = () =>
  useQuery({ queryKey: keys.musicHome, queryFn: () => api<MusicHomeDto>(apiPaths.musicHome).catch(nullIfMissing) });

/** Every album, newest first; screens sort them on the phone, so a sort change needs no refetch. */
export const useAlbums = (enabled = true) =>
  useQuery({ queryKey: keys.albums, queryFn: () => api<AlbumSummary[]>(apiPaths.albums("added")), enabled });

export const useAlbum = (id: string) => useQuery({ queryKey: keys.album(id), queryFn: () => api<AlbumDetail>(apiPaths.album(id)) });

export const useArtists = (enabled = true) =>
  useQuery({ queryKey: keys.artists, queryFn: () => api<ArtistSummary[]>(apiPaths.artists), enabled });

/** The Liked tab: liked albums, then liked songs, newest like first. Null on a server from before likes (1.4). */
export const useLikedMusic = (enabled = true) =>
  useQuery({ queryKey: keys.musicLiked, queryFn: () => api<LikedMusicDto>(apiPaths.musicLiked).catch(nullIfMissing), enabled });

/** An album's colour from the cache, looked up once per album rather than on every render. */
export function useAlbumColor(id: string | undefined): string | null {
  return useMemo(() => (id ? cachedAlbumColor(id) : null), [id]);
}

/** An album's cover colour from what's already loaded (its page or an album list); songs carry none of their own. */
function cachedAlbumColor(id: string): string | null {
  const detail = queryClient.getQueryData<AlbumDetail>(keys.album(id));
  if (detail) return detail.coverColor;
  for (const [, list] of queryClient.getQueriesData<AlbumSummary[]>({ queryKey: keys.all.albums })) {
    const found = list?.find((a) => a.id === id);
    if (found) return found.coverColor;
  }
  return null;
}

/** All of an artist's albums and songs. */
export const useArtist = (id: string) => useQuery({ queryKey: keys.artist(id), queryFn: () => api<ArtistDetail>(apiPaths.artist(id)) });

/**
 * Likes songs or albums, or unlikes them. Every cached list shows the heart at once, and the Liked
 * tab gains or loses them; a failure puts it all back.
 */
export async function setLiked(change: { albums?: AlbumSummary[]; tracks?: TrackDto[] }, on: boolean) {
  const albumIds = new Set(change.albums?.map((a) => a.id));
  const trackIds = new Set(change.tracks?.map((t) => t.id));
  const album = <A extends AlbumSummary>(a: A): A => (albumIds.has(a.id) ? { ...a, liked: on } : a);
  const track = (t: TrackDto): TrackDto => (trackIds.has(t.id) ? { ...t, liked: on } : t);
  const tracks = (list: TrackDto[] | undefined) => list?.map(track);

  // What each list held, to put back if the server can't take it (offline too).
  const snapshot = LIKE_LISTS.flatMap((queryKey) => queryClient.getQueriesData({ queryKey }));
  const before = queryClient.getQueryData<LikedMusicDto | null>(keys.musicLiked);
  queryClient.setQueriesData<TrackDto>({ queryKey: keys.all.track }, (t) => t && track(t));
  queryClient.setQueriesData<AlbumSummary[]>({ queryKey: keys.all.albums }, (list) => list?.map(album));
  queryClient.setQueriesData<TrackDto[]>({ queryKey: keys.all.tracks }, tracks);
  queryClient.setQueriesData<TrackDto[]>({ queryKey: keys.trackPlays }, tracks);
  queryClient.setQueriesData<AlbumDetail>({ queryKey: keys.all.album }, (a) => a && { ...album(a), tracks: a.tracks.map(track) });
  queryClient.setQueriesData<ArtistDetail>({ queryKey: keys.all.artist }, (a) => a && { ...a, albums: a.albums.map(album), appearsOn: a.appearsOn.map(track) });
  queryClient.setQueriesData<PlaylistDetail>({ queryKey: keys.all.playlist }, (p) => p && { ...p, tracks: p.tracks.map(track) });
  queryClient.setQueryData<MusicHomeDto | null>(
    keys.musicHome,
    (h) =>
      h && {
        ...h,
        onRepeat: h.onRepeat?.map(track),
        newAlbums: h.newAlbums?.map(album),
        jumpBackIn: h.jumpBackIn?.map((i) => (i.kind === "album" ? { ...i, album: album(i.album) } : i)),
        moreLikeAlbum: h.moreLikeAlbum && { ...h.moreLikeAlbum, items: h.moreLikeAlbum.items.map(album) },
      },
  );
  queryClient.setQueriesData<SearchResultsDto>({ queryKey: keys.all.search }, (r) => r && { ...r, songs: r.songs.map(track), albums: r.albums.map(album) });
  if (before) {
    const likedAlbums = (change.albums ?? []).map((a) => ({ ...a, liked: true }));
    const likedTracks = (change.tracks ?? []).map((t) => ({ ...t, liked: true }));
    queryClient.setQueryData<LikedMusicDto>(keys.musicLiked, {
      albums: on ? [...likedAlbums, ...before.albums.filter((a) => !albumIds.has(a.id))] : before.albums.filter((a) => !albumIds.has(a.id)),
      tracks: on ? [...likedTracks, ...before.tracks.filter((t) => !trackIds.has(t.id))] : before.tracks.filter((t) => !trackIds.has(t.id)),
    });
  }

  const body: MusicLikeChange = {};
  if (albumIds.size) body.albumIds = [...albumIds];
  if (trackIds.size) body.trackIds = [...trackIds];
  try {
    await api(apiPaths.musicLikes, { method: on ? "PUT" : "DELETE", body });
    void queryClient.invalidateQueries({ queryKey: keys.musicLiked });
  } catch (err) {
    toast.error(err instanceof Error ? err.message : on ? "Couldn't like that." : "Couldn't unlike that.");
    // Every heart goes back as it was, then the server is asked again for the truth.
    for (const [queryKey, data] of snapshot) queryClient.setQueryData(queryKey, data);
    for (const queryKey of LIKE_LISTS) void queryClient.invalidateQueries({ queryKey });
  }
}

/** Every cached list a like shows in. */
const LIKE_LISTS = [
  keys.all.albums,
  keys.all.tracks,
  keys.all.track,
  keys.trackPlays,
  keys.all.album,
  keys.all.artist,
  keys.all.playlist,
  keys.musicHome,
  keys.musicLiked,
  keys.all.search,
];

/** A song as some loaded list has it (its album, a playlist, Liked, Recently played), for liking one known only by id. */
function cachedTrack(id: string): TrackDto | undefined {
  const lists: (TrackDto[] | undefined)[] = [
    queryClient.getQueryData<LikedMusicDto>(keys.musicLiked)?.tracks,
    queryClient.getQueryData<TrackDto[]>(keys.trackPlays),
    ...queryClient.getQueriesData<AlbumDetail>({ queryKey: keys.all.album }).map(([, a]) => a?.tracks),
    ...queryClient.getQueriesData<PlaylistDetail>({ queryKey: keys.all.playlist }).map(([, p]) => p?.tracks),
    ...queryClient.getQueriesData<TrackDto[]>({ queryKey: keys.all.tracks }).map(([, list]) => list),
  ];
  for (const list of lists) {
    const found = list?.find((t) => t.id === id);
    if (found) return found;
  }
  return undefined;
}

/**
 * Whether the song is liked, from the song itself (a song on a hidden album isn't in Liked), with
 * any change made here on top. Undefined on a server from before likes, which shows no heart.
 */
export function useTrackLiked(id: string | undefined): boolean | undefined {
  const song = useQuery({
    queryKey: keys.track(id ?? ""),
    queryFn: () => api<TrackDto>(apiPaths.track(id!)),
    enabled: !!id,
    // A list's copy shows at once (and offline) until the song's own comes.
    placeholderData: () => (id ? cachedTrack(id) : undefined),
  });
  return id ? song.data?.liked : undefined;
}

/** Likes or unlikes the song playing, known only by id. */
export async function setTrackLiked(id: string, on: boolean) {
  const track = queryClient.getQueryData<TrackDto>(keys.track(id)) ?? cachedTrack(id);
  if (track) return setLiked({ tracks: [track] }, on);
  toast.error("Couldn't do that.");
}

// ---------- Playlists (each person's own) ----------

/** Your playlists, newest change first. */
export const usePlaylists = (enabled = true) =>
  useQuery({ queryKey: keys.playlists, queryFn: () => api<PlaylistSummary[]>(apiPaths.playlists), enabled });

export const usePlaylist = (id: string) => useQuery({ queryKey: keys.playlist(id), queryFn: () => api<PlaylistDetail>(apiPaths.playlist(id)) });

/** Keeps the playlist's page and the list of playlists in step with what the server sent back. */
function savedPlaylist(p: PlaylistDetail): PlaylistDetail {
  queryClient.setQueryData(keys.playlist(p.id), p);
  const { tracks: _tracks, ...summary } = p;
  queryClient.setQueryData<PlaylistSummary[]>(keys.playlists, (list) => (list ? [summary, ...list.filter((x) => x.id !== p.id)] : list));
  void queryClient.invalidateQueries({ queryKey: keys.playlists });
  return p;
}

export const createPlaylist = async (name: string, trackIds: string[] = []) =>
  savedPlaylist(await api<PlaylistDetail>(apiPaths.playlists, { method: "POST", body: { name, trackIds } }));

/** Rename it, or give its songs in their new order (reorder and remove are both this). */
export const updatePlaylist = async (id: string, change: { name?: string; trackIds?: string[] }) =>
  savedPlaylist(await api<PlaylistDetail>(apiPaths.playlist(id), { method: "PATCH", body: change }));

/** Songs on the server matching a search the server runs, to pick from. */
export const useTrackSearch = (q: string, enabled = true) =>
  useQuery({
    queryKey: keys.tracks(q),
    queryFn: () => api<TrackDto[]>(apiPaths.tracks(q)),
    placeholderData: keepPreviousData,
    enabled,
  });

/** Songs you've played, most recent first. */
export const useRecentTracks = (enabled = true) => useQuery({ queryKey: keys.trackPlays, queryFn: () => api<TrackDto[]>(apiPaths.trackPlays), enabled });

/** Adds songs to the end; ones already in it stay where they are. */
export const addToPlaylist = async (id: string, trackIds: string[]) =>
  savedPlaylist(await api<PlaylistDetail>(apiPaths.playlistTracks(id), { method: "POST", body: { trackIds } }));

export async function deletePlaylist(id: string) {
  await api(apiPaths.playlist(id), { method: "DELETE" });
  queryClient.setQueryData<PlaylistSummary[]>(keys.playlists, (list) => list?.filter((x) => x.id !== id));
  queryClient.removeQueries({ queryKey: keys.playlist(id) });
}

export const usePodcasts = () =>
  useQuery({ queryKey: keys.podcasts, queryFn: () => api<PodcastSummary[]>(apiPaths.podcasts) });

export const usePodcast = (id: string) =>
  useQuery({ queryKey: keys.podcast(id), queryFn: () => api<PodcastDetail>(apiPaths.podcast(id)) });

/** Every episode of a show. Long shows have over a thousand, so it waits until it's needed. */
export const useEpisodes = (podcastId: string, enabled = true) =>
  useQuery({ queryKey: keys.episodes(podcastId), queryFn: () => api<EpisodeDto[]>(apiPaths.podcastEpisodes(podcastId)), enabled });

/** A show's newest episodes, the first page of its list. Its key sits under the full list's, so invalidating one covers both. */
export const useFirstEpisodes = (podcastId: string, enabled = true) =>
  useQuery({
    queryKey: keys.episodesFirst(podcastId),
    queryFn: () => api<EpisodeDto[]>(apiPaths.podcastEpisodes(podcastId, EPISODE_PAGE)),
    enabled,
  });

// Lists ask for short notes (`short=1`); a row fetches the full notes when it's expanded.

export const useNewEpisodes = () =>
  useQuery({ queryKey: keys.newEpisodes, queryFn: () => api<EpisodeWithShow[]>(apiPaths.newEpisodes(50)) });

/** Started, unfinished episodes, most recently listened first. */
export const useContinueEpisodes = () =>
  useQuery({ queryKey: keys.continueEpisodes, queryFn: () => api<EpisodeWithShow[]>(apiPaths.continueEpisodes(20)) });

/** After progress, played or archived state changes, refresh the lists that show it. */
export function invalidateListening() {
  void queryClient.invalidateQueries({ queryKey: keys.books });
  void queryClient.invalidateQueries({ queryKey: keys.newEpisodes });
  void queryClient.invalidateQueries({ queryKey: keys.continueEpisodes });
  void queryClient.invalidateQueries({ queryKey: keys.podcasts });
  void queryClient.invalidateQueries({ queryKey: keys.all.episodes });
  void queryClient.invalidateQueries({ queryKey: keys.all.book });
  // Movies and shows, whose progress goes through the same outbox.
  void queryClient.invalidateQueries({ queryKey: keys.watch.all });
}

/** After saved places reach the server, refresh only what shows those items. */
export function invalidateProgress(items: ProgressItem[]) {
  const refresh = (queryKey: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey });
  if (items.some((i) => i.itemType === "book")) refresh(keys.books);
  if (items.some((i) => i.itemType === "episode")) {
    refresh(keys.newEpisodes);
    refresh(keys.continueEpisodes);
    refresh(keys.all.episodes);
  }
  // Only finishing one changes a show's count of what's new.
  if (items.some((i) => i.itemType === "episode" && i.finished)) refresh(keys.podcasts);
  // Movies and shows (watchKeys.all): a TV episode's place doesn't say which show it's in.
  if (items.some((i) => i.itemType === "video")) refresh(keys.watch.all);
  for (const i of items) {
    if (i.itemType === "book") refresh(keys.book(i.itemId));
    if (i.itemType === "episode") refresh(keys.episode(i.itemId));
  }
}

/** Book details, from cache when available (works offline for anything opened before). */
export function fetchBook(id: string): Promise<BookDetail> {
  return queryClient.fetchQuery({ queryKey: keys.book(id), queryFn: () => api<BookDetail>(apiPaths.book(id)), staleTime: 60_000 });
}

export function fetchEpisode(id: string): Promise<EpisodeWithShow> {
  return queryClient.fetchQuery({
    queryKey: keys.episode(id),
    queryFn: () => api<EpisodeWithShow>(apiPaths.episode(id)),
    staleTime: 60_000,
  });
}

/**
 * An episode's notes: as listed until the row is opened, then in full if the list cut them
 * short (`short=1`). Shares the cache entry the player uses for the same episode.
 */
export function useEpisodeNotes(episode: EpisodeDto, open: boolean): string | null {
  const full = useQuery({
    queryKey: keys.episode(episode.id),
    queryFn: () => api<EpisodeWithShow>(apiPaths.episode(episode.id)),
    enabled: open && !!episode.descriptionCut,
    staleTime: 60_000,
  });
  return (episode.descriptionCut ? full.data?.description : null) ?? episode.description;
}

// ---------- Play next: books lined up to start, in your order ----------

/** The shelf's books in order, as the cached list has them. */
function playNextOrder(): string[] {
  const books = queryClient.getQueryData<BookSummary[]>(keys.books) ?? [];
  return books
    .filter((b) => b.playNext != null)
    .sort((a, b) => a.playNext! - b.playNext!)
    .map((b) => b.id);
}

/** Shows a new order at once, in the book list and on book pages. */
function showPlayNext(order: string[]) {
  const at = new Map(order.map((id, i) => [id, i]));
  const place = <T extends BookSummary>(b: T): T => ({ ...b, playNext: at.get(b.id) ?? null });
  queryClient.setQueryData<BookSummary[]>(keys.books, (list) => list?.map(place));
  queryClient.setQueriesData<BookDetail>({ queryKey: keys.all.book }, (b) => b && place(b));
}

async function changePlayNext(order: string[], send: () => Promise<unknown>) {
  const before = playNextOrder();
  showPlayNext(order);
  try {
    await send();
  } catch (err) {
    showPlayNext(before);
    throw err;
  } finally {
    void queryClient.invalidateQueries({ queryKey: keys.books });
  }
}

/**
 * Takes books out of the library; their files stay where they are. One goes through its own
 * route, which older servers have too. Throws what went wrong.
 */
export async function removeBooks(books: { id: string; title: string }[]) {
  if (books.length === 1) await api(apiPaths.book(books[0]!.id), { method: "DELETE" });
  else await api(apiPaths.booksBulk, { method: "POST", body: { action: "remove", ids: books.map((b) => b.id) } });
  void queryClient.invalidateQueries();
  toast.show(`Removed ${books.length === 1 ? books[0]!.title : plural(books.length, "book")} from the library`);
}

/** Sets Author, Narrator or Series on several books at once, each keeping its own series number. */
export async function editBooks(ids: string[], fields: Partial<BulkEditForm>) {
  await api(apiPaths.booksBulk, { method: "POST", body: { action: "edit", ids, fields } });
  void queryClient.invalidateQueries();
  toast.show(`Saved ${plural(ids.length, "book")}`);
}

/** Sets the shelf's order, e.g. after a drag. */
export function orderPlayNext(bookIds: string[]) {
  return changePlayNext(bookIds, () => api(apiPaths.playNextOrder, { method: "PUT", body: { bookIds } }));
}

/**
 * Puts a book on the shelf (at the end) or takes it off, with a toast to undo it. Undoing a
 * removal puts the book back where it was.
 */
export async function setPlayNext(bookId: string, on: boolean, undoing = false) {
  const before = playNextOrder();
  try {
    if (on) {
      await changePlayNext(before.includes(bookId) ? before : [...before, bookId], () => api(apiPaths.bookPlayNext(bookId), { method: "POST" }));
    } else {
      await changePlayNext(
        before.filter((id) => id !== bookId),
        () => api(apiPaths.bookPlayNext(bookId), { method: "DELETE" }),
      );
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Couldn't change Play next.");
    return;
  }
  if (undoing) return;
  toast.show(on ? "Added to Play next" : "Removed from Play next", {
    action: {
      label: "Undo",
      onPress: () => {
        // Re-adding goes to the end; the old order puts it back in its place.
        if (on) void setPlayNext(bookId, false, true);
        else void setPlayNext(bookId, true, true).then(() => orderPlayNext(before).catch((err: unknown) => toast.error(errorText(err))));
      },
    },
  });
}
