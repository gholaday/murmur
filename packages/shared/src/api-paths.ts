// ---------- URL helpers shared by web and app ----------

export const apiPaths = {
  coverUrl: (bookId: string, coverHash: string, size: 200 | 600) =>
    `/api/books/${bookId}/cover?size=${size}&h=${coverHash}`,
  bookFileUrl: (bookId: string, fileIndex: number) =>
    `/api/stream/book/${bookId}/${fileIndex}`,
  podcastCoverUrl: (podcastId: string, coverHash: string, size: 200 | 600) =>
    `/api/podcasts/${podcastId}/cover?size=${size}&h=${coverHash}`,
  /** Relays the publisher's audio through the server; supports range requests. */
  episodeUrl: (episodeId: string) => `/api/stream/episode/${episodeId}`,
};
