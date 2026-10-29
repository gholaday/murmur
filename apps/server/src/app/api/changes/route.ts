import { CHANGES_HEADER, changesToken } from "@/server/changes";
import { getContext } from "@/server/context";

/** Live updates: the change counts and whether a scan is running, in the header (see server/changes.ts). */
export async function GET(): Promise<Response> {
  await getContext();
  return new Response(null, { status: 204, headers: { [CHANGES_HEADER]: changesToken(), "Cache-Control": "no-store" } });
}
