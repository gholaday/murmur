import { notFound } from "next/navigation";
import { getContext } from "@/server/context";
import { hiddenFor, visibleMovie } from "@/server/hidden";
import { requirePageUser } from "@/server/session";
import { getMovie } from "@/server/watch/queries";
import { MovieView } from "@/web/watch/movie-view";

export default async function MoviePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const ctx = await getContext();
  const found = await getMovie(ctx, user.id, (await params).id);
  if (!found) notFound();
  const movie = visibleMovie(found, hiddenFor(ctx, user.id));
  // Keyed, so moving to another film from its shelves starts fresh (version, description).
  return <MovieView key={movie.id} movie={movie} />;
}
