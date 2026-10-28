import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";
import { endStream } from "@/server/watch/stream-session";

type Ctx = { params: Promise<{ session: string }> };

/** Ends a stream: the player closed, or seeked somewhere a new one starts. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const user = requireUser(await getContext(), req);
  endStream(user.id, (await params).session);
  return json({ ok: true });
});
