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
  /** AlbumSummary[], all of them. */
  albums: (sort: "added" | "name" | "artist" | "year" = "added") => `/api/music/albums?sort=${sort}`,
  /** AlbumDetail. */
  album: (albumId: string) => `/api/music/albums/${albumId}`,
  albumCoverUrl: (albumId: string, coverHash: string, size: 200 | 600) =>
    `/api/music/albums/${albumId}/cover?size=${size}&h=${coverHash}`,
  /** ArtistSummary[], A to Z. */
  artists: "/api/music/artists",
  /** ArtistDetail. */
  artist: (artistId: string) => `/api/music/artists/${artistId}`,
  /** TrackDto[], A to Z, or matching `q` (title, artist or album). */
  tracks: (q?: string) => (q ? `/api/music/tracks?q=${encodeURIComponent(q)}` : "/api/music/tracks"),
  /** A song's audio; supports range requests. */
  trackUrl: (trackId: string) => `/api/stream/track/${trackId}`,
};
