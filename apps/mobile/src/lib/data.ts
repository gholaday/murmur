import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  type AlbumDetail,
  type AlbumSummary,
  apiPaths,
  type ArtistDetail,
  type ArtistSummary,
  type MusicMineChange,
  type MusicScope,
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
  type UserPrefs,
  type UserPrefsPatch,
  type VideoQuality,
  EPISODE_PAGE,
} from "@murmur/shared/client";
import { toast } from "@/components/toast";
import { api } from "./api";
import { queryClient } from "./query";

export const keys = {
  books: ["books"] as const,
  book: (id: string) => ["book", id] as const,
  podcasts: ["podcasts"] as const,
  podcast: (id: string) => ["podcast", id] as const,
  episodes: (podcastId: string) => ["episodes", podcastId] as const,
  newEpisodes: ["newEpisodes"] as const,
  continueEpisodes: ["continueEpisodes"] as const,
  /** The player's own copy of Up Next, kept for offline; the player owns it, nothing fetches it. */
  upNext: ["upNext"] as const,
  prefs: ["prefs"] as const,
  music: ["music"] as const,
  albums: (scope: MusicScope) => ["albums", scope] as const,
  album: (id: string) => ["album", id] as const,
  artists: (scope: MusicScope) => ["artists", scope] as const,
  artist: (id: string) => ["artist", id] as const,
  tracks: (scope: MusicScope) => ["tracks", scope] as const,
  playlists: ["playlists"] as const,
  trackPlays: ["trackPlays"] as const,
  playlist: (id: string) => ["playlist", id] as const,
};

// Your own settings (Books tab layout, which tabs show), saved on the server so the web and the
// app share them. Until they load, or on a server without them, the defaults apply.
const usePrefs = () => useQuery({ queryKey: keys.prefs, queryFn: () => api<UserPrefs>(apiPaths.prefs) });

export function useBookSections(): BookSection[] {
  return bookSections(usePrefs().data?.bookSections);
}

/** Optional tabs; each is on unless you've switched it off. */
export function useTabPrefs(): UserPrefs["tabs"] {
  const tabs = usePrefs().data?.tabs;
  return { podcasts: tabs?.podcasts ?? true, music: tabs?.music ?? true, watch: tabs?.watch ?? true };
}

/** Saves a change, showing it at once; puts the old prefs back if the server says no. */
function savePrefs(patch: UserPrefsPatch, failed: string) {
  const previous = queryClient.getQueryData<UserPrefs>(keys.prefs);
  if (previous) queryClient.setQueryData<UserPrefs>(keys.prefs, { ...previous, ...patch } as UserPrefs);
  api<UserPrefs>(apiPaths.prefs, { method: "PUT", body: patch })
    .then((saved) => queryClient.setQueryData(keys.prefs, saved))
    .catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : failed);
      if (previous) queryClient.setQueryData(keys.prefs, previous);
      else void queryClient.resetQueries({ queryKey: keys.prefs });
    });
}

export const saveBookSections = (next: BookSection[]) => savePrefs({ bookSections: next }, "Couldn't save the layout.");

export const saveTabPrefs = (tabs: UserPrefs["tabs"]) => savePrefs({ tabs }, "Couldn't save the tabs.");

/** The quality the server converts video at; full until your prefs load. */
export const useVideoQuality = (): VideoQuality => usePrefs().data?.videoQuality ?? "full";

/** The same, for the player, loading your prefs if nothing has yet. */
export async function readVideoQuality(): Promise<VideoQuality> {
  try {
    return (await queryClient.fetchQuery({ queryKey: keys.prefs, queryFn: () => api<UserPrefs>(apiPaths.prefs) })).videoQuality ?? "full";
  } catch {
    return "full";
  }
}

/** Whether the next episode starts on its own when one ends; on until your prefs say otherwise. */
export const useAutoplayNext = (): boolean => usePrefs().data?.autoplayNext ?? true;

export const saveAutoplayNext = (autoplayNext: boolean) => savePrefs({ autoplayNext }, "Couldn't save that.");

export const saveVideoQuality =(videoQuality: VideoQuality) => savePrefs({ videoQuality }, "Couldn't save the quality.");

export const useBooks = () => useQuery({ queryKey: keys.books, queryFn: () => api<BookSummary[]>("/api/books") });

export const useBook = (id: string) =>
  useQuery({ queryKey: keys.book(id), queryFn: () => api<BookDetail>(`/api/books/${id}`) });

/** Whether the server has music; everything about music hides until it says so. */
export const useMusicSummary = () => useQuery({ queryKey: keys.music, queryFn: () => api<MusicSummaryDto>(apiPaths.music) });

// Music comes in two scopes: "mine" is your music (songs you added, and their albums and artists),
// "all" is everything, shown under Browse.

/** Albums newest first; screens sort them on the phone, so a sort change needs no refetch. */
export const useAlbums = (scope: MusicScope, enabled = true) =>
  useQuery({ queryKey: keys.albums(scope), queryFn: () => api<AlbumSummary[]>(apiPaths.albums(scope, "added")), enabled });

export const useAlbum = (id: string) => useQuery({ queryKey: keys.album(id), queryFn: () => api<AlbumDetail>(apiPaths.album(id)) });

export const useArtists = (scope: MusicScope, enabled = true) =>
  useQuery({ queryKey: keys.artists(scope), queryFn: () => api<ArtistSummary[]>(apiPaths.artists(scope)), enabled });

/** An album's cover colour from what's already loaded (its page or an album list); songs carry none of their own. */
export function cachedAlbumColor(id: string): string | null {
  const detail = queryClient.getQueryData<AlbumDetail>(keys.album(id));
  if (detail) return detail.coverColor;
  for (const [, list] of queryClient.getQueriesData<AlbumSummary[]>({ queryKey: ["albums"] })) {
    const found = list?.find((a) => a.id === id);
    if (found) return found.coverColor;
  }
  return null;
}

/** All of an artist's albums and songs, each marked with how much is in your music. */
export const useArtist = (id: string) => useQuery({ queryKey: keys.artist(id), queryFn: () => api<ArtistDetail>(apiPaths.artist(id)) });

/** Songs A to Z; lists filter them on the phone. */
export const useTracks = (scope: MusicScope, enabled = true) =>
  useQuery({ queryKey: keys.tracks(scope), queryFn: () => api<TrackDto[]>(apiPaths.tracks(scope)), enabled });

/**
 * Adds songs to your music, or removes them; an album means all its songs. Every cached list shows
 * the change at once, then everything music refetches from the server.
 */
export async function setInMusic(change: { albums?: AlbumSummary[]; tracks?: TrackDto[] }, on: boolean) {
  const albumIds = new Set(change.albums?.map((a) => a.id));
  // Only songs that actually change move their album's count.
  const moved = (change.tracks ?? []).filter((t) => t.inMusic !== on);
  const trackIds = new Set(moved.map((t) => t.id));
  const delta = new Map<string, number>();
  for (const t of moved) delta.set(t.albumId, (delta.get(t.albumId) ?? 0) + (on ? 1 : -1));

  const album = <A extends AlbumSummary>(a: A): A =>
    albumIds.has(a.id)
      ? { ...a, songsInMusic: on ? a.trackCount : 0 }
      : delta.has(a.id)
        ? { ...a, songsInMusic: Math.max(0, Math.min(a.trackCount, a.songsInMusic + delta.get(a.id)!)) }
        : a;
  const track = (t: TrackDto): TrackDto => (albumIds.has(t.albumId) || trackIds.has(t.id) ? { ...t, inMusic: on } : t);

  queryClient.setQueriesData<AlbumSummary[]>({ queryKey: ["albums"] }, (list) => list?.map(album));
  queryClient.setQueriesData<TrackDto[]>({ queryKey: ["tracks"] }, (list) => list?.map(track));
  queryClient.setQueriesData<AlbumDetail>({ queryKey: ["album"] }, (a) => a && { ...album(a), tracks: a.tracks.map(track) });
  queryClient.setQueriesData<ArtistDetail>({ queryKey: ["artist"] }, (a) => a && { ...a, albums: a.albums.map(album), appearsOn: a.appearsOn.map(track) });

  const body: MusicMineChange = {};
  if (albumIds.size) body.albumIds = [...albumIds];
  if (change.tracks?.length) body.trackIds = change.tracks.map((t) => t.id);
  try {
    const summary = await api<MusicSummaryDto>(apiPaths.mine, { method: on ? "PUT" : "DELETE", body });
    queryClient.setQueryData(keys.music, summary);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : on ? "Couldn't add that." : "Couldn't remove that.");
  } finally {
    for (const key of ["music", "albums", "artists", "tracks", "album", "artist"]) void queryClient.invalidateQueries({ queryKey: [key] });
  }
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

/** Songs to pick from: yours or everything on the server, matching a search the server runs. */
export const useTrackSearch = (scope: MusicScope, q: string, enabled = true) =>
  useQuery({
    queryKey: q ? [...keys.tracks(scope), q] : keys.tracks(scope),
    queryFn: () => api<TrackDto[]>(apiPaths.tracks(scope, q || undefined)),
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
  useQuery({ queryKey: keys.podcasts, queryFn: () => api<PodcastSummary[]>("/api/podcasts") });

export const usePodcast = (id: string) =>
  useQuery({ queryKey: keys.podcast(id), queryFn: () => api<PodcastDetail>(`/api/podcasts/${id}`) });

/** Every episode of a show. Long shows have over a thousand, so it waits until it's needed. */
export const useEpisodes = (podcastId: string, enabled = true) =>
  useQuery({ queryKey: keys.episodes(podcastId), queryFn: () => api<EpisodeDto[]>(`/api/podcasts/${podcastId}/episodes?short=1`), enabled });

/** A show's newest episodes, the first page of its list. Its key sits under the full list's, so invalidating one covers both. */
export const useFirstEpisodes = (podcastId: string, enabled = true) =>
  useQuery({
    queryKey: [...keys.episodes(podcastId), "first"],
    queryFn: () => api<EpisodeDto[]>(`/api/podcasts/${podcastId}/episodes?short=1&limit=${EPISODE_PAGE}`),
    enabled,
  });

// Lists ask for short notes (`short=1`); a row fetches the full notes when it's expanded.

export const useNewEpisodes = () =>
  useQuery({ queryKey: keys.newEpisodes, queryFn: () => api<EpisodeWithShow[]>("/api/episodes/new?limit=50&short=1") });

/** Started, unfinished episodes, most recently listened first. */
export const useContinueEpisodes = () =>
  useQuery({ queryKey: keys.continueEpisodes, queryFn: () => api<EpisodeWithShow[]>("/api/episodes/continue?limit=20&short=1") });

/** After progress, played or archived state changes, refresh the lists that show it. */
export function invalidateListening() {
  void queryClient.invalidateQueries({ queryKey: keys.books });
  void queryClient.invalidateQueries({ queryKey: keys.newEpisodes });
  void queryClient.invalidateQueries({ queryKey: keys.continueEpisodes });
  void queryClient.invalidateQueries({ queryKey: keys.podcasts });
  void queryClient.invalidateQueries({ queryKey: ["episodes"] });
  void queryClient.invalidateQueries({ queryKey: ["book"] });
  // Movies and shows (watchKeys.all), whose progress goes through the same outbox.
  void queryClient.invalidateQueries({ queryKey: ["watch"] });
}

/** Book details, from cache when available (works offline for anything opened before). */
export function fetchBook(id: string): Promise<BookDetail> {
  return queryClient.fetchQuery({ queryKey: keys.book(id), queryFn: () => api<BookDetail>(`/api/books/${id}`), staleTime: 60_000 });
}

export function fetchEpisode(id: string): Promise<EpisodeWithShow> {
  return queryClient.fetchQuery({
    queryKey: ["episode", id],
    queryFn: () => api<EpisodeWithShow>(`/api/episodes/${id}`),
    staleTime: 60_000,
  });
}

/**
 * An episode's notes: as listed until the row is opened, then in full if the list cut them
 * short (`short=1`). Shares the cache entry the player uses for the same episode.
 */
export function useEpisodeNotes(episode: EpisodeDto, open: boolean): string | null {
  const full = useQuery({
    queryKey: ["episode", episode.id],
    queryFn: () => api<EpisodeWithShow>(`/api/episodes/${episode.id}`),
    enabled: open && !!episode.descriptionCut,
    staleTime: 60_000,
  });
  return (episode.descriptionCut ? full.data?.description : null) ?? episode.description;
}

/** Marks a book or episode finished, or resets it to the start. */
export async function setFinished(itemType: "book" | "episode", itemId: string, durationSec: number, finished: boolean) {
  await api("/api/progress", {
    method: "PUT",
    body: {
      items: [{ itemType, itemId, positionSec: finished ? durationSec : 0, durationSec, finished, updatedAt: Date.now() }],
    },
  });
  invalidateListening();
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
  queryClient.setQueriesData<BookDetail>({ queryKey: ["book"] }, (b) => b && place(b));
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
        else void setPlayNext(bookId, true, true).then(() => orderPlayNext(before).catch(() => undefined));
      },
    },
  });
}
