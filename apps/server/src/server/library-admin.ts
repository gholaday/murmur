import { bookIssues, type LibraryAdminDto, type ScanStatusDto } from "@murmur/shared";
import { listBooks } from "./books";
import type { AppContext } from "./context";
import { listAlbums } from "./music/queries";
import type { ScanState } from "./library/scanner";
import { watchSummary } from "./watch/queries";

const scanOf = (s: ScanState): ScanStatusDto => ({ running: s.running, lastFinishedAt: s.lastFinishedAt, lastError: s.lastError });

/** You > Library for admins, the same on the web and in the app. */
export async function libraryAdmin(ctx: AppContext, userId: number): Promise<LibraryAdminDto> {
  const books = await listBooks(ctx, userId);
  const albums = await listAlbums(ctx, userId, "all", "artist");
  const watch = watchSummary(ctx);
  return {
    books: {
      total: books.filter((b) => b.missingSince === null).length,
      attention: books.filter((b) => bookIssues(b).length > 0).length,
      unmatched: books.filter((b) => !b.matched).length,
      scan: scanOf(ctx.scanState),
    },
    music: { albums: albums.length, unmatched: albums.filter((a) => !a.matched).length, scan: scanOf(ctx.music.state) },
    watch: { movies: watch.movies, shows: watch.shows, scan: scanOf(ctx.watch.state) },
  };
}
