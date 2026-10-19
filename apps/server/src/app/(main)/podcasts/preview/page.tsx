import { redirect } from "next/navigation";
import { subscribeSchema } from "@murmur/shared";
import { getContext } from "@/server/context";
import { HttpError } from "@/server/http";
import { previewPodcast } from "@/server/podcasts/search";
import { requirePageUser } from "@/server/session";
import { PreviewView } from "@/web/podcasts/preview-view";

/** A search result's details before subscribing: /podcasts/preview?feed=<RSS URL>. */
export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ feed?: string }> }) {
  const user = await requirePageUser();
  const ctx = await getContext();
  const parsed = subscribeSchema.safeParse({ feedUrl: (await searchParams).feed ?? "" });
  if (!parsed.success) return <PreviewView error="That isn't a feed URL." />;
  let preview;
  try {
    preview = await previewPodcast(ctx.sqlite, ctx.podcasts, user.id, parsed.data.feedUrl);
  } catch (err) {
    if (err instanceof HttpError) return <PreviewView error={err.message} />;
    throw err;
  }
  // Already following it: the real page has everything this one would.
  if (preview.subscribedId) redirect(`/podcasts/${preview.subscribedId}`);
  return <PreviewView preview={preview} />;
}
