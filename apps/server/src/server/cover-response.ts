import fs from "node:fs/promises";
import { env } from "./env";
import { HttpError } from "./http";
import { coverFile, type CoverSize } from "./library/covers";

/** Serves a resized cover. A request carrying the current hash (`?h=`) is cached forever. */
export async function coverResponse(req: Request, hash: string | null): Promise<Response> {
  if (!hash) throw new HttpError(404, "No cover.");
  const url = new URL(req.url);
  const size: CoverSize = url.searchParams.get("size") === "200" ? 200 : 600;
  const immutable = url.searchParams.get("h") === hash;
  const headers = {
    "Content-Type": "image/webp",
    "Cache-Control": immutable ? "private, max-age=31536000, immutable" : "private, no-cache",
    ETag: `"${hash}-${size}"`,
  };
  // Covers without ?h= are revalidated on every view; answer those without reading the file.
  if (req.headers.get("if-none-match") === headers.ETag) return new Response(null, { status: 304, headers });
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(coverFile(env.coversDir, hash, size));
  } catch {
    throw new HttpError(404, "Cover not found. A rescan will regenerate it.");
  }
  // A Buffer is already a Uint8Array; wrapping it in a new one copied every image.
  return new Response(bytes as Uint8Array<ArrayBuffer>, { headers });
}
