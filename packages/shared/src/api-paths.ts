// ---------- URL helpers shared by web and app ----------

export const apiPaths = {
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
  /** GET your settings, PUT the ones that changed. */
  prefs: "/api/me/prefs",

  /** MusicSummaryDto: whether there's music, and how much. */
  music: "/api/music",
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
  /** TrackDto[], A to Z, or matching `q` (title, artist or album). */
  tracks: (scope: "mine" | "all", q?: string) => `/api/music/tracks?scope=${scope}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
  /** PUT adds songs to your music, DELETE removes them: body MusicMineChange. */
  mine: "/api/music/mine",
  /** GET PlayContextDto (or null), PUT a new context, PATCH { index } as songs move on. */
  playContext: "/api/music/context",
  /** POST { trackId } once a song counts as played. */
  trackPlays: "/api/music/plays",
  /** TrackDto. */
  track: (trackId: string) => `/api/music/tracks/${trackId}`,
  /** A song's audio; supports range requests. */
  trackUrl: (trackId: string) => `/api/stream/track/${trackId}`,
};
