import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { route } from "@/server/http";
import { streamFile } from "@/server/stream";
import { masterPlaylist, streamFilePath, streamMimeType } from "@/server/watch/stream-session";

type Ctx = { params: Promise<{ session: string; file: string }> };

/** A stream's playlists or one of its pieces, waiting briefly for ffmpeg to write it. */
export const GET = route<Ctx>(async (req, { params }) => {
  const user = requireUser(await getContext(), req);
  const { session, file } = await params;
  if (file === "master.m3u8") {
    return new Response(masterPlaylist(user.id, session), { headers: { "Content-Type": streamMimeType(file), "Cache-Control": "no-store" } });
  }
  const res = await streamFile(req, await streamFilePath(user.id, session, file), streamMimeType(file));
  // The playlist grows while ffmpeg works, so it's never cached.
  if (file.endsWith(".m3u8")) res.headers.set("Cache-Control", "no-store");
  return res;
});
