import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { env } from "../env";
import { HttpError } from "../http";
import { coverColor, MAX_INPUT_PIXELS, saveCoverMeta } from "../library/covers";

// Posters (2:3) and wide pictures (16:9: backdrops and stills), stored beside the square covers
// in the covers folder and served the same way. Only the shape and sizes differ.

export type ArtShape = "poster" | "wide";
export type ArtSize = "small" | "large";

const SIZES: Record<ArtShape, Record<ArtSize, [number, number]>> = {
  poster: { small: [200, 300], large: [400, 600] },
  wide: { small: [320, 180], large: [960, 540] },
};

export function artFile(coversDir: string, hash: string, shape: ArtShape, size: ArtSize): string {
  const [w, h] = SIZES[shape][size];
  return path.join(coversDir, `${hash}-${w}x${h}.webp`);
}

/**
 * Resizes an image once into both sizes of its shape, and returns its content hash. A frame
 * grabbed from a wide movie has black bars, which `trimBars` cuts off before the 16:9 crop.
 */
export async function storeArt(coversDir: string, source: Buffer, shape: ArtShape, opts: { trimBars?: boolean } = {}): Promise<string> {
  const hash = crypto
    .createHash("sha1")
    .update(source)
    .update(opts.trimBars ? "trim" : "")
    .digest("hex")
    .slice(0, 16);
  await fs.mkdir(coversDir, { recursive: true });
  let image = sharp(source, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS }).rotate();
  if (opts.trimBars) {
    // Re-decoded from the trimmed pixels, since sharp can't trim and then resize in one pipeline.
    const trimmed = await image.clone().trim({ background: "#000000", threshold: 24 }).toBuffer().catch(() => null);
    if (trimmed) image = sharp(trimmed);
  }
  let wrote = false;
  for (const size of ["large", "small"] as const) {
    const out = artFile(coversDir, hash, shape, size);
    if (await fs.access(out).then(() => true, () => false)) continue;
    const [w, h] = SIZES[shape][size];
    const tmp = `${out}.${process.pid}.tmp`;
    await image.clone().resize(w, h, { fit: "cover" }).webp({ quality: 80 }).toFile(tmp);
    await fs.rename(tmp, out);
    wrote = true;
  }
  if (wrote) {
    const { width } = await image.metadata();
    await saveCoverMeta(coversDir, hash, await coverColor(image), width ?? null);
  }
  return hash;
}

/** Serves a poster, backdrop or still. A request carrying the current hash (`?h=`) is cached forever. */
export async function artResponse(req: Request, hash: string | null, shape: ArtShape): Promise<Response> {
  if (!hash) throw new HttpError(404, "No picture.");
  const url = new URL(req.url);
  const size: ArtSize = url.searchParams.get("size") === "small" ? "small" : "large";
  const headers = {
    "Content-Type": "image/webp",
    "Cache-Control": url.searchParams.get("h") === hash ? "private, max-age=31536000, immutable" : "private, no-cache",
    ETag: `"${hash}-${shape}-${size}"`,
  };
  if (req.headers.get("if-none-match") === headers.ETag) return new Response(null, { status: 304, headers });
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(artFile(env.coversDir, hash, shape, size));
  } catch {
    throw new HttpError(404, "Picture not found. A rescan will make it again.");
  }
  return new Response(bytes as Uint8Array<ArrayBuffer>, { headers });
}
