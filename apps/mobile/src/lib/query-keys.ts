import type { MusicScope, SearchKind } from "@murmur/shared/client";

// Every React Query key in the app, in one place. Each kind's first part is written once (`root`);
// matching on it reaches every query of that kind, which is how the saved cache (query.ts) and
// live updates (changes.ts) pick theirs.

const root = {
  serverVersion: ["server-version"],
  health: ["health"],
  libraryAdmin: ["library-admin"],
  libraryFolders: ["library-folders"],
  users: ["users"],
  episodeCache: ["episode-cache"],
  stats: ["stats"],
  search: ["search"],
  books: ["books"],
  book: ["book"],
  podcasts: ["podcasts"],
  podcast: ["podcast"],
  podcastSearch: ["podcast-search"],
  podcastPreview: ["podcast-preview"],
  episodes: ["episodes"],
  episode: ["episode"],
  newEpisodes: ["newEpisodes"],
  continueEpisodes: ["continueEpisodes"],
  upNext: ["upNext"],
  prefs: ["prefs"],
  music: ["music"],
  albums: ["albums"],
  album: ["album"],
  artists: ["artists"],
  artist: ["artist"],
  tracks: ["tracks"],
  playlists: ["playlists"],
  playlist: ["playlist"],
  trackPlays: ["trackPlays"],
  watch: ["watch"],
} as const;

const watchMovie = [...root.watch, "movie"] as const;
const watchShow = [...root.watch, "show"] as const;

export const keys = {
  /** Each kind's first part: every query of that kind. */
  all: root,
  serverVersion: root.serverVersion,
  health: root.health,
  libraryAdmin: root.libraryAdmin,
  libraryFolders: (kind: string) => [...root.libraryFolders, kind] as const,
  users: root.users,
  episodeCache: root.episodeCache,
  stats: (period: string, today: string, year: number | null) => [...root.stats, period, today, year] as const,
  /** Every search on one kind's tab. */
  searchKind: (kind: SearchKind) => [...root.search, kind] as const,
  search: (q: string, kind: SearchKind) => [...root.search, kind, q] as const,
  books: root.books,
  book: (id: string) => [...root.book, id] as const,
  podcasts: root.podcasts,
  podcast: (id: string) => [...root.podcast, id] as const,
  podcastSearch: (term: string) => [...root.podcastSearch, term] as const,
  podcastPreview: (feedUrl: string) => [...root.podcastPreview, feedUrl] as const,
  episodes: (podcastId: string) => [...root.episodes, podcastId] as const,
  /** The first page of a show's episodes, shown while the rest load. */
  episodesFirst: (podcastId: string) => [...root.episodes, podcastId, "first"] as const,
  episode: (id: string) => [...root.episode, id] as const,
  newEpisodes: root.newEpisodes,
  continueEpisodes: root.continueEpisodes,
  /** The player's own copy of Up Next, kept for offline; the player owns it, nothing fetches it. */
  upNext: root.upNext,
  prefs: root.prefs,
  music: root.music,
  musicHome: [...root.music, "home"] as const,
  albums: (scope: MusicScope) => [...root.albums, scope] as const,
  album: (id: string) => [...root.album, id] as const,
  artists: (scope: MusicScope) => [...root.artists, scope] as const,
  artist: (id: string) => [...root.artist, id] as const,
  tracks: (scope: MusicScope) => [...root.tracks, scope] as const,
  playlists: root.playlists,
  trackPlays: root.trackPlays,
  playlist: (id: string) => [...root.playlist, id] as const,
  watch: {
    all: root.watch,
    home: [...root.watch, "home"] as const,
    movies: [...root.watch, "movies"] as const,
    /** Every movie page. */
    allMovies: watchMovie,
    movie: (id: string) => [...watchMovie, id] as const,
    shows: [...root.watch, "shows"] as const,
    /** Every show page. */
    allShows: watchShow,
    show: (id: string) => [...watchShow, id] as const,
  },
};

/** Whether `key` is `prefix` or a key under it. */
export const keyStartsWith = (key: readonly unknown[], prefix: readonly unknown[]) => prefix.every((part, i) => key[i] === part);
