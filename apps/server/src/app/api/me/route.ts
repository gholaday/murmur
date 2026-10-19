import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";

export const GET = route(async (req) => {
  const ctx = await getContext();
  return json(requireUser(ctx, req));
});
