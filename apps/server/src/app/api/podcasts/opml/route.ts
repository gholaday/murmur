import type { OpmlImportResult } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, route } from "@/server/http";
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

/** Import an OPML file (send the file's text as the request body). */
export const POST = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const body = await req.text();
  if (body.length > 5 * 1024 * 1024) throw new HttpError(413, "OPML file is too large.");
  let feeds;
  try {
    feeds = parseOpml(body);
  } catch {
    throw new HttpError(400, "That file isn't valid OPML.");
  }
  if (feeds.length === 0) throw new HttpError(400, "No podcast feeds found in that file.");

  const result: OpmlImportResult = { added: 0, alreadySubscribed: 0, failed: [] };
  for (const f of feeds) {
    try {
      const { created } = await ctx.podcasts.subscribe(user.id, f.feedUrl);
      if (created) result.added++;
      else result.alreadySubscribed++;
    } catch (err) {
      result.failed.push({ feedUrl: f.feedUrl, error: errorMessage(err) });
    }
  }
  return json(result);
});
