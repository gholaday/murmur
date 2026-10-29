import { notFound } from "next/navigation";
import { apiPaths, episodeLabel } from "@murmur/shared";
import { getContext } from "@/server/context";
import { getPrefs } from "@/server/prefs";
import { requirePageUser } from "@/server/session";
import { getEpisodePlay, getMovie } from "@/server/watch/queries";
import type { PlayerItem } from "@/web/watch/video-player";
import { OpenVideo } from "@/web/watch/video-session";

/** The video player for a movie (`?v=` picks a version) or an episode. The shell shows it; this opens it. */
export default async function PlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ v?: string; q?: string }>;
}) {
  const user = await requirePageUser();
  const ctx = await getContext();
  const { kind, id } = await params;
  const { v, q } = await searchParams;
  const prefs = getPrefs(ctx, user.id);
  // A quality picked before pressing Play (`?q=`), for this video only; otherwise your setting applies.
  const quality = q === "full" || q === "light" ? q : prefs.videoQuality;
  let item: PlayerItem;
  if (kind === "movie") {
    const movie = await getMovie(ctx, user.id, id);
    if (!movie) notFound();
    const version = movie.versionList.find((x) => x.id === v) ?? movie.versionList[0]!;
    item = {
      kind: "movie",
      progressId: movie.id,
      href: `/watch/play/movie/${movie.id}${version.id === movie.versionList[0]!.id ? "" : `?v=${version.id}`}`,
      title: movie.title,
      showTitle: null,
      label: null,
      color: movie.color,
      art: movie.backdropHash
        ? apiPaths.movieArtUrl(movie.id, "backdrop", movie.backdropHash)
        : movie.posterHash
          ? apiPaths.movieArtUrl(movie.id, "poster", movie.posterHash)
          : null,
      quality,
      videoId: version.id,
      src: apiPaths.videoUrl(version.id),
      file: version.file,
      durationSec: version.durationSec,
      startAt: movie.progress && !movie.progress.finished ? movie.progress.positionSec : 0,
      backHref: `/watch/movie/${movie.id}`,
      next: [],
      autoplayNext: false,
      memoryKey: movie.id,
    };
  } else if (kind === "episode") {
    const play = await getEpisodePlay(ctx, user.id, id);
    if (!play) notFound();
    const e = play.episode;
    item = {
      kind: "episode",
      progressId: e.id,
      href: `/watch/play/episode/${e.id}`,
      title: e.title,
      showTitle: play.show.title,
      label: episodeLabel(e.season, e.episode),
      color: play.show.color,
      art: e.stillHash ? apiPaths.videoStillUrl(e.id, e.stillHash) : null,
      quality,
      videoId: e.id,
      src: apiPaths.videoUrl(e.id),
      file: e.file,
      durationSec: e.durationSec,
      startAt: e.progress && !e.progress.finished ? e.progress.positionSec : 0,
      backHref: `/watch/show/${play.show.id}?season=${e.season}`,
      next: play.next,
      autoplayNext: prefs.autoplayNext,
      memoryKey: play.show.id,
    };
  } else notFound();
  return <OpenVideo item={item} />;
}
