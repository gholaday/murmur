import { type OpmlImportResult, subscribeSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, route } from "@/server/http";
import { createLimiter } from "@/server/library/probe";
import { errorMessage } from "@/server/log";
import { buildOpml, parseOpml } from "@/server/podcasts/feed";
import { subscribedFeeds } from "@/server/podcasts/queries";

/** Download your subscriptions as OPML, to move them to or from another podcast app. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return new Response(buildOpml(subscribedFeeds(ctx.sqlite, user.id)), {
    headers: {
      "Content-Type": "text/x-opml; charset=utf-8",
      "Content-Disposition": 'attachment; filename="murmur-subscriptions.opml"',
    },
  });
});

const MAX_OPML_BYTES = 5 * 1024 * 1024;

/** Import an OPML file (send the file's text as the request body). */
export const POST = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_OPML_BYTES) throw new HttpError(413, "OPML file is too large.");
  const body = await req.text();
  if (body.length > MAX_OPML_BYTES) throw new HttpError(413, "OPML file is too large.");
  let feeds;
  try {
    feeds = parseOpml(body);
  } catch {
    throw new HttpError(400, "That file isn't valid OPML.");
  }
  if (feeds.length === 0) throw new HttpError(400, "No podcast feeds found in that file.");

  const result: OpmlImportResult = { added: 0, alreadySubscribed: 0, failed: [] };
  // A few feeds at a time, so a long list doesn't wait on each slow feed in turn. The same feed
  // twice in the file is fetched once, so two subscribes to it can't race.
  const limit = createLimiter(4);
  const unique = [...new Map(feeds.map((f) => [f.feedUrl, f])).values()];
  await Promise.all(
    unique.map(async (f) => {
      // The same rules as subscribing by hand: http or https, and not absurdly long.
      const checked = subscribeSchema.safeParse({ feedUrl: f.feedUrl });
      if (!checked.success) {
        result.failed.push({ feedUrl: f.feedUrl.slice(0, 200), error: "Not an http or https address." });
        return;
      }
      try {
        const { created } = await limit(() => ctx.podcasts.subscribe(user.id, checked.data.feedUrl));
        if (created) result.added++;
        else result.alreadySubscribed++;
      } catch (err) {
        result.failed.push({ feedUrl: f.feedUrl, error: errorMessage(err) });
      }
    }),
  );
  return json(result);
});
