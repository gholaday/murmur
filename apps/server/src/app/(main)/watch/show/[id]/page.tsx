import { notFound } from "next/navigation";
import { getContext } from "@/server/context";
import { requirePageUser } from "@/server/session";
import { getShow } from "@/server/watch/queries";
import { TvShowView } from "@/web/watch/tv-show-view";

export default async function ShowPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const ctx = await getContext();
  const show = await getShow(ctx, user.id, (await params).id);
  if (!show) notFound();
  return <TvShowView show={show} />;
}
