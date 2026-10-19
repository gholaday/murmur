import { matchApplySchema } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";
import { previewMatch } from "@/server/metadata/match";

const querySchema = matchApplySchema.pick({ provider: true, providerId: true });

/** Current vs proposed values for one candidate: `?provider=audible&providerId=B0…`. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const url = new URL(req.url);
  const { provider, providerId } = querySchema.parse({
    provider: url.searchParams.get("provider"),
    providerId: url.searchParams.get("providerId"),
  });
  return json(await previewMatch(ctx, (await params).id, provider, providerId));
});
