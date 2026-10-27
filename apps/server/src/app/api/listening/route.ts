import { listeningReportSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { saveListening } from "@/server/stats";

/** A device's running listening totals per day; resending them never counts twice. */
export const PUT = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const report = await readJson(req, listeningReportSchema);
  return json({ saved: saveListening(ctx, user.id, report) });
});
