import { requireUser } from "@/server/auth";
import { listBooks } from "@/server/books";
import { getContext } from "@/server/context";
import { hiddenFor, visibleBooks } from "@/server/hidden";
import { jsonWithEtag, route } from "@/server/http";

/** Every book, newest first, leaving out ones you hid. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return jsonWithEtag(req, visibleBooks(await listBooks(ctx, user.id), hiddenFor(ctx, user.id)));
});
