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
  /** POST adds the book to the end of your Play next shelf, DELETE takes it off. */
  bookPlayNext: (bookId: string) => `/api/books/${bookId}/play-next`,
  /** PUT { bookIds } sets the shelf's order. */
  playNextOrder: "/api/play-next",

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
};
