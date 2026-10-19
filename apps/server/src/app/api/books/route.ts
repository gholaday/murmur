import { requireUser } from "@/server/auth";
import { listBooks } from "@/server/books";
import { getContext } from "@/server/context";
import { jsonWithEtag, route } from "@/server/http";

export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return jsonWithEtag(req, await listBooks(ctx, user.id));
});
