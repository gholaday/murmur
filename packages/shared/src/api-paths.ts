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
};
