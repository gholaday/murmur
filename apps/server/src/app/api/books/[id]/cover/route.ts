import { coverUrlSchema } from "@murmur/shared";
import { requireAdmin, requireUser } from "@/server/auth";
import { getCoverHash } from "@/server/books";
import { getContext } from "@/server/context";
import { coverResponse } from "@/server/cover-response";
import { HttpError, json, readJson, route } from "@/server/http";
import { getEditInfo, resetCover, setCover, setCoverFromUrl } from "@/server/metadata/edits";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  return coverResponse(req, getCoverHash(ctx, (await params).id));
});

/** Sets a custom cover: an uploaded image (multipart field "image") or `{ url }` to download. */
export const POST = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const id = (await params).id;
  if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const file = (await req.formData()).get("image");
    if (!(file instanceof File)) throw new HttpError(400, "No image was uploaded.");
    await setCover(ctx, id, Buffer.from(await file.arrayBuffer()));
  } else {
    await setCoverFromUrl(ctx, id, (await readJson(req, coverUrlSchema)).url);
  }
  return json(await getEditInfo(ctx, id));
});

/** Goes back to the cover found in the files. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const id = (await params).id;
  resetCover(ctx, id);
  return json(await getEditInfo(ctx, id));
});
