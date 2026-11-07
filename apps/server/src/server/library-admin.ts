import type { LibraryAdminDto, ScanStatusDto } from "@murmur/shared";
import { bookCounts } from "./books";
import type { AppContext } from "./context";
import { albumCounts } from "./music/queries";
import type { ScanState } from "./library/scan-loop";
import { watchSummary } from "./watch/queries";

const scanOf = (s: ScanState): ScanStatusDto => ({ running: s.running, lastFinishedAt: s.lastFinishedAt, lastError: s.lastError });

/** You > Library for admins, the same on the web and in the app. Counts only, nothing per person. */
export function libraryAdmin(ctx: AppContext): LibraryAdminDto {
  const albums = albumCounts(ctx);
  const watch = watchSummary(ctx);
  return {
    books: { ...bookCounts(ctx), scan: scanOf(ctx.scanState) },
    music: { ...albums, scan: scanOf(ctx.music.state) },
    watch: { movies: watch.movies, shows: watch.shows, scan: scanOf(ctx.watch.state) },
  };
}
