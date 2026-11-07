import type { SearchKind } from "./search";

// ---------- URL helpers shared by web and app ----------

export const apiPaths = {
  /** BookDetail. */
  book: (bookId: string) => `/api/books/${bookId}`,
  /** EpisodeWithShow. */
  episode: (episodeId: string) => `/api/episodes/${episodeId}`,
  /** GET the show; PATCH { speed } and its other settings. */
  podcast: (podcastId: string) => `/api/podcasts/${podcastId}`,
  /** PUT { items } saves places, the newest change winning. */
  progress: "/api/progress",
  /** PUT the listening time gathered since the last send. */
  listening: "/api/listening",
  coverUrl: (bookId: string, coverHash: string, size: 200 | 600) =>
    `/api/books/${bookId}/cover?size=${size}&h=${coverHash}`,
  bookFileUrl: (bookId: string, fileIndex: number) =>
    `/api/stream/book/${bookId}/${fileIndex}`,
  podcastCoverUrl: (podcastId: string, coverHash: string, size: 200 | 600) =>
    `/api/podcasts/${podcastId}/cover?size=${size}&h=${coverHash}`,
  /** The server's copy of an episode, or the publisher's audio relayed; supports range requests. */
  episodeUrl: (episodeId: string) => `/api/stream/episode/${episodeId}`,
  /** Ad times for an episode (EpisodeAdsDto). */
  episodeAds: (episodeId: string) => `/api/episodes/${episodeId}/ads`,
  episodeChapters: (episodeId: string) => `/api/episodes/${episodeId}/chapters`,
  /** `{ id }` of the episode below (1, older) or above (-1, newer) in its show's list, or null at the end. */
  episodeNeighbor: (episodeId: string, dir: 1 | -1) => `/api/episodes/${episodeId}/neighbor?dir=${dir}`,
  /** GET your settings, PUT the ones that changed. */
  prefs: "/api/me/prefs",
  /** GET BookmarkDto[], all of yours in order; PUT { items } saves new and edited ones. */
  bookmarks: "/api/bookmarks",
  /** DELETE removes it. */
  bookmark: (bookmarkId: string) => `/api/bookmarks/${bookmarkId}`,
  /** POST adds the book to the end of your Play next shelf, DELETE takes it off. */
  bookPlayNext: (bookId: string) => `/api/books/${bookId}/play-next`,
  /** PUT { bookIds } sets the shelf's order. */
  playNextOrder: "/api/play-next",

  /** MusicSummaryDto: whether there's music, and how much. */
  music: "/api/music",
  /** MusicHomeDto: the Home chip's shelves. */
  musicHome: "/api/music/home",
  /** AlbumSummary[]: "mine" is albums you have songs from, "all" is Browse. */
  albums: (scope: "mine" | "all", sort: "added" | "name" | "artist" | "year" = "added") => `/api/music/albums?scope=${scope}&sort=${sort}`,
  /** AlbumDetail. */
  album: (albumId: string) => `/api/music/albums/${albumId}`,
  albumCoverUrl: (albumId: string, coverHash: string, size: 200 | 600) =>
    `/api/music/albums/${albumId}/cover?size=${size}&h=${coverHash}`,
  /** ArtistSummary[], A to Z. */
  artists: (scope: "mine" | "all") => `/api/music/artists?scope=${scope}`,
  /** ArtistDetail. */
  artist: (artistId: string) => `/api/music/artists/${artistId}`,
  artistPhotoUrl: (artistId: string, photoHash: string, size: 200 | 600) =>
    `/api/music/artists/${artistId}/photo?size=${size}&h=${photoHash}`,
  /** TrackDto[], A to Z, or matching `q` (title, artist or album). */
  tracks: (scope: "mine" | "all", q?: string) => `/api/music/tracks?scope=${scope}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
  /** PUT adds songs to your music, DELETE removes them: body MusicMineChange. */
  mine: "/api/music/mine",
  /**
   * Up Next, one running list. GET UpNextDto; PUT the whole list (UpNextInput) after a change;
   * PATCH { index } as it moves on; POST { itemType, itemId, at } adds an item from anywhere.
   */
  upNext: "/api/up-next",
  /** POST { trackId } once a song counts as played; GET TrackDto[], most recently played first. */
  trackPlays: "/api/music/plays",
  /** TrackDto. */
  track: (trackId: string) => `/api/music/tracks/${trackId}`,
  /** GET PlaylistSummary[] (yours, newest change first), POST a new one: returns PlaylistDetail. */
  playlists: "/api/music/playlists",
  /** GET PlaylistDetail, PATCH name or song order, DELETE. */
  playlist: (playlistId: string) => `/api/music/playlists/${playlistId}`,
  /** POST { trackIds } adds songs to the end: returns PlaylistDetail. */
  playlistTracks: (playlistId: string) => `/api/music/playlists/${playlistId}/tracks`,
  /** A song's audio; supports range requests. */
  trackUrl: (trackId: string) => `/api/stream/track/${trackId}`,

  /** WatchHomeDto. */
  watchHome: "/api/watch",
  /** MovieSummary[], A to Z. */
  movies: "/api/watch/movies",
  /** MovieDetail. */
  movie: (movieId: string) => `/api/watch/movies/${movieId}`,
  /** ShowSummary[], A to Z. */
  shows: "/api/watch/shows",
  /** ShowDetail. */
  show: (showId: string) => `/api/watch/shows/${showId}`,
  /** Posters are 2:3, backdrops and stills 16:9. */
  movieArtUrl: (movieId: string, kind: "poster" | "backdrop", hash: string, size: "small" | "large" = "large") =>
    `/api/watch/movies/${movieId}/${kind}?size=${size}&h=${hash}`,
  showArtUrl: (showId: string, kind: "poster" | "backdrop", hash: string, size: "small" | "large" = "large") =>
    `/api/watch/shows/${showId}/${kind}?size=${size}&h=${hash}`,
  /** A movie version's or episode's still. */
  videoStillUrl: (videoId: string, hash: string, size: "small" | "large" = "large") =>
    `/api/watch/videos/${videoId}/still?size=${size}&h=${hash}`,
  /** A movie version or episode file as it is; supports range requests. */
  videoUrl: (videoId: string) => `/api/stream/video/${videoId}`,
  /**
   * A subtitle track as WebVTT. `offset` is for a Chromecast playing a stream, whose clock starts
   * there. A 503 with Retry-After means it's being read out of the video: ask again.
   */
  videoSubtitle: (videoId: string, trackId: string, offset = 0) =>
    `/api/watch/videos/${videoId}/subtitles/${trackId}.vtt${offset > 0 ? `?offset=${offset.toFixed(3)}` : ""}`,
  /** POST starts a remuxed (HLS) stream of a video. */
  videoStream: (videoId: string) => `/api/watch/videos/${videoId}/stream`,
  /**
   * POST `{ track, audio, video, quality }` starts making a video into an MP4 for the phone to keep,
   * or reports on the one already being made: VideoDownloadDto. For files the phone can't play as
   * they are; others download from videoUrl.
   */
  videoDownload: (videoId: string) => `/api/watch/videos/${videoId}/download`,
  /** GET the finished MP4 (range requests work); DELETE cancels or removes it. */
  videoDownloadFile: (downloadId: string) => `/api/watch/downloads/${downloadId}`,
  /** DELETE ends a stream session. */
  streamSession: (sessionId: string) => `/api/watch/streams/${sessionId}`,
  /** POST `{ paths }` (prefixes of streams and pictures) → CastLinkDto, links a Chromecast can open. */
  cast: "/api/cast",
  /** SearchResultsDto: books, podcasts, music and Watch at once, or one `kind`. */
  search: (q: string, kind: SearchKind = "all") =>
    `/api/search?q=${encodeURIComponent(q)}&kind=${kind}`,

  // ---------- Sign-in and the server ----------

  /** POST { username, password }. */
  login: "/api/auth/login",
  /** POST { username, password }: the first account, before anyone exists. */
  setup: "/api/auth/setup",
  logout: "/api/auth/logout",
  /** HealthDto. Open to anyone, for telling a server is there. */
  health: "/api/health",
  /** ServerVersionDto. */
  serverVersion: "/api/server/version",
  /** The changes token, in a header, for knowing when to reload. */
  changes: "/api/changes",
  /** PUT { currentPassword, newPassword }. */
  password: "/api/me/password",
  /** GET UserDto[], POST a new account. */
  users: "/api/users",
  /** DELETE removes the account. */
  user: (userId: number) => `/api/users/${userId}`,
  /** StatsDto. */
  stats: (q: { period: string; today: string; tz: string; year?: number | null }) =>
    `/api/stats?${new URLSearchParams({ period: q.period, today: q.today, tz: q.tz, ...(q.year ? { year: String(q.year) } : {}) })}`,
  /** LibraryAdminDto: counts and scan status. */
  libraryAdmin: "/api/library/admin",
  /** POST starts a scan. */
  scan: { books: "/api/library/scan", music: "/api/music/scan", watch: "/api/watch/scan" },
  /** GET the folders, PUT { paths }. */
  folders: { books: "/api/library/folders", music: "/api/music/folders", movies: "/api/watch/folders/movies", shows: "/api/watch/folders/shows" },
  /** GET EpisodeCacheStatusDto, PUT { episodesPerShow }. */
  episodeCache: "/api/server/cache",
  /** POST runs failed ad scans again. */
  adsRetry: "/api/server/ads/retry",

  // ---------- Books ----------

  /** BookSummary[]. */
  books: "/api/books",
  /** BookEditInfo. */
  bookEdit: (bookId: string) => `/api/books/${bookId}/edit`,
  /** PUT the edited details: BookEditInfo. */
  bookDetails: (bookId: string) => `/api/books/${bookId}/details`,
  /** PUT { chapters }, null for the files' own: BookEditInfo. */
  bookChapters: (bookId: string) => `/api/books/${bookId}/chapters`,
  /** POST an image or { url }, DELETE for the files' cover: BookEditInfo. */
  bookCover: (bookId: string) => `/api/books/${bookId}/cover`,
  /** POST reads the book's files again. */
  bookRescan: (bookId: string) => `/api/books/${bookId}/rescan`,
  /** GET MatchSearchResult, by its own title or the one given; POST applies a match; DELETE undoes it. */
  bookMatch: (bookId: string, custom?: { title: string; author: string }) =>
    `/api/books/${bookId}/match${custom ? `?${new URLSearchParams(custom)}` : ""}`,
  /** MatchPreview. */
  bookMatchPreview: (bookId: string, c: { provider: string; providerId: string }) =>
    `/api/books/${bookId}/match/preview?${new URLSearchParams({ provider: c.provider, providerId: c.providerId })}`,
  /** POST marks the book as needing no match, DELETE lists it under Not matched again. */
  bookMatchMarked: (bookId: string) => `/api/books/${bookId}/match/marked`,
  /** Match all for books: GET the list; `/apply` and `/undo` below it. */
  libraryMatch: "/api/library/match",

  // ---------- Podcasts ----------

  /** GET PodcastSummary[], POST { feedUrl } follows a show. */
  podcasts: "/api/podcasts",
  /** PodcastSearchResult[]. */
  podcastSearch: (q: string) => `/api/podcasts/search?q=${encodeURIComponent(q)}`,
  /** PodcastPreview, before following. */
  podcastPreview: (feedUrl: string) => `/api/podcasts/preview?feedUrl=${encodeURIComponent(feedUrl)}`,
  /** GET your shows as OPML, POST an OPML file to follow them. */
  podcastsOpml: "/api/podcasts/opml",
  /** EpisodeDto[], short notes, the newest `limit` or all. */
  podcastEpisodes: (podcastId: string, limit?: number) =>
    `/api/podcasts/${podcastId}/episodes?short=1${limit ? `&limit=${limit}` : ""}`,
  /** POST checks the feed now. */
  podcastRefresh: (podcastId: string) => `/api/podcasts/${podcastId}/refresh`,
  /** EpisodeWithShow[]: the newest across your shows. */
  newEpisodes: (limit: number) => `/api/episodes/new?limit=${limit}&short=1`,
  /** EpisodeWithShow[]: started and not finished. */
  continueEpisodes: (limit: number) => `/api/episodes/continue?limit=${limit}&short=1`,

  // ---------- Music and Watch matching ----------

  /** GET AlbumMatchSearch, by its own title or the one given; POST applies a match. */
  albumMatch: (albumId: string, custom?: { title: string; artist: string }) =>
    `/api/music/albums/${albumId}/match${custom ? `?${new URLSearchParams(custom)}` : ""}`,
  /** AlbumMatchPreview. */
  albumMatchPreview: (albumId: string, c: { provider: string; providerId: string }) =>
    `/api/music/albums/${albumId}/match/preview?${new URLSearchParams({ provider: c.provider, providerId: c.providerId })}`,
  /** Match all for music: GET the list; `/apply` and `/undo` below it. */
  musicMatch: "/api/music/match",
  /** PUT { providerId } sets the photo. */
  artistPhoto: (artistId: string) => `/api/music/artists/${artistId}/photo`,
  /** ArtistPhotoOption[], for the artist's name or `q`. */
  artistPhotoOptions: (artistId: string, q?: string) =>
    `/api/music/artists/${artistId}/photo/options${q ? `?${new URLSearchParams({ q })}` : ""}`,
  /** A movie or show, for editing: its details, pictures (`/poster`, `/backdrop`) and `/match` below it. */
  watchItem: (kind: "movie" | "show", id: string) => `/api/watch/${kind === "movie" ? "movies" : "shows"}/${id}`,
  /** WatchMatchResult[]. */
  watchMatchSearch: (q: { kind: "movie" | "show"; q: string; year?: string }) =>
    `/api/watch/match?${new URLSearchParams({ kind: q.kind, q: q.q, ...(q.year ? { year: q.year } : {}) })}`,
};
