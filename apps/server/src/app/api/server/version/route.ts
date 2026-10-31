import type { ServerVersionDto } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { backupStatus } from "@/server/backup-status";
import { getContext } from "@/server/context";
import { env } from "@/server/env";
import { json, route } from "@/server/http";
import { updateStatus } from "@/server/updates";

/** The running version, and for admins whether a newer release is out. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const body: ServerVersionDto = {
    version: env.version,
    devBuild: env.devBuild,
    updates: user.isAdmin ? updateStatus() : null,
    backup: user.isAdmin ? backupStatus() : null,
  };
  return json(body);
});
