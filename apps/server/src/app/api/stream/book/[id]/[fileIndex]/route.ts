import { requireUser } from "@/server/auth";
import { getBookFile } from "@/server/books";
import { getContext } from "@/server/context";
import { env } from "@/server/env";
import { HttpError, route } from "@/server/http";
import { resolveInside, streamFile } from "@/server/stream";

type Ctx = { params: Promise<{ id: string; fileIndex: string }> };

const handler = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  const { id, fileIndex } = await params;
  const index = Number.parseInt(fileIndex, 10);
  if (!Number.isInteger(index) || index < 0) throw new HttpError(400, "Invalid file index.");
  const file = getBookFile(ctx, id, index);
  if (!file) throw new HttpError(404, "File not found.");
  return streamFile(req, resolveInside(env.libraryDir, file.relPath), file.mimeType);
});

export const GET = handler;
export const HEAD = handler;
