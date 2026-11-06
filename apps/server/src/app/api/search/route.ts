import { searchQuerySchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, queryText, route } from "@/server/http";
import { search } from "@/server/search";

/** Books, podcasts, music and Watch at once (`?kind=all`), or one kind; `?q=` is what's typed. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const url = new URL(req.url);
  const { q, kind } = searchQuerySchema.parse({ q: queryText(url, "q"), kind: url.searchParams.get("kind") ?? undefined });
  return json(await search(ctx, user.id, q, kind));
});
