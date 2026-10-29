import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp, { type OutputInfo, type Sharp } from "sharp";

export const COVER_SIZES = [200, 600] as const;
export type CoverSize = (typeof COVER_SIZES)[number];
const LARGEST = Math.max(...COVER_SIZES);

// Covers are written to disk once and served from there, so libvips' in-memory operation
// cache only holds memory. Keep it off.
sharp.cache(false);

export function coverFile(coversDir: string, hash: string, size: CoverSize): string {
  return path.join(coversDir, `${hash}-${size}.webp`);
}

export interface CoverMeta {
  /** Main colour as #rrggbb, used to tint page headers. */
  color: string;
  /** Width of the original image, when known; Match only replaces a cover with a larger one. */
  sourceWidth: number | null;
  /** Which colour rule worked out `color`; older ones are worked out again. */
  v?: number;
}

/** Bumped whenever coverColor changes, so stored colours are redone on next use. */
const COLOR_VERSION = 2;

const metaCache = new Map<string, CoverMeta | null>();

function metaFile(coversDir: string, hash: string): string {
  return path.join(coversDir, `${hash}.json`);
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/**
 * The colour a cover reads as, for tinting its page header. The biggest histogram bucket
 * (sharp's "dominant") lands on white for a dark cover with white lettering, so colours are
 * counted on a small copy with colourful pixels counting for more and near-white for less.
 */
export async function coverColor(image: Sharp): Promise<string> {
  const { data, info } = await image.clone().resize(32, 32, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map<number, { w: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 2 < data.length; i += info.channels) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 510;
    const saturation = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
    // Paper and lettering count for a quarter; strong colour counts up to four times.
    const w = (1 + 3 * saturation) * (lightness > 0.9 ? 0.25 : 1);
    // 3 bits per channel: 512 buckets, coarse enough that shading lands together.
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) ?? { w: 0, r: 0, g: 0, b: 0 };
    bucket.w += w;
    bucket.r += r * w;
    bucket.g += g * w;
    bucket.b += b * w;
    buckets.set(key, bucket);
  }
  let best = { w: 0, r: 0, g: 0, b: 0 };
  for (const bucket of buckets.values()) if (bucket.w > best.w) best = bucket;
  return best.w ? hex(best.r / best.w, best.g / best.w, best.b / best.w) : "#000000";
}

/**
 * Colour and size details for a stored cover. Covers stored before this existed, or whose
 * colour came from an older rule, get it worked out from the small rendition on first use.
 */
export async function coverMeta(coversDir: string, hash: string): Promise<CoverMeta | null> {
  if (metaCache.has(hash)) return metaCache.get(hash) ?? null;
  let meta: CoverMeta | null = null;
  try {
    meta = JSON.parse(await fs.readFile(metaFile(coversDir, hash), "utf8")) as CoverMeta;
  } catch {
    // Not stored yet.
  }
  if (meta?.v !== COLOR_VERSION) {
    try {
      const color = await coverColor(sharp(coverFile(coversDir, hash, 200), { failOn: "none" }));
      meta = { color, sourceWidth: meta?.sourceWidth ?? null, v: COLOR_VERSION };
      await fs.writeFile(metaFile(coversDir, hash), JSON.stringify(meta));
    } catch {
      // No rendition to read; keep whatever was stored.
    }
  }
  metaCache.set(hash, meta);
  return meta;
}

/** Stores the colour of an image kept in another shape (Watch's posters and stills), so coverColors finds it. */
export async function saveCoverMeta(coversDir: string, hash: string, color: string, sourceWidth: number | null) {
  const meta: CoverMeta = { color, sourceWidth, v: COLOR_VERSION };
  await fs.writeFile(metaFile(coversDir, hash), JSON.stringify(meta));
  metaCache.set(hash, meta);
}

/**
 * The cover colour made usable as a header tint behind light text: same hue,
 * lightness capped so a white or pastel cover still gives a dark, readable header.
 */
export function tintFor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const L = Math.min(l, 0.42);
  const c = (1 - Math.abs(2 * L - 1)) * s;
  const x = c * (1 - Math.abs(((h % 6) + 6) % 2 - 1));
  const m = L - c / 2;
  const [rr, gg, bb] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return `#${[rr, gg, bb].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Header tints for many covers at once; unknown hashes are left out. */
export async function coverColors(coversDir: string, hashes: Iterable<string | null>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const hash of new Set(hashes)) {
    if (!hash) continue;
    const meta = await coverMeta(coversDir, hash);
    if (meta) out.set(hash, tintFor(meta.color));
  }
  return out;
}

/**
 * Resizes a source image once into every served size and returns its content hash.
 * Identical source images share files, and existing outputs are not rewritten.
 */
/** A small file can still be a huge picture (a 20,000-pixel square decodes to over a gigabyte); past this, sharp refuses. */
export const MAX_INPUT_PIXELS = 40_000_000;

export async function storeCover(coversDir: string, source: Buffer): Promise<string> {
  const hash = crypto.createHash("sha1").update(source).digest("hex").slice(0, 16);
  await fs.mkdir(coversDir, { recursive: true });

  // Decode the source once, straight down to the largest served size; podcast artwork is
  // often 3000px, and decoding that for every step costs far more memory than the outputs.
  let base: { data: Buffer; info: OutputInfo } | null = null;
  const fromBase = async () => {
    base ??= await sharp(source, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(LARGEST, LARGEST, { fit: "cover", withoutEnlargement: false })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = base.info;
    return sharp(base.data, { raw: { width, height, channels } });
  };

  const known = await coverMeta(coversDir, hash);
  if (!known?.sourceWidth || known.v !== COLOR_VERSION) {
    // Reads only the header.
    const { width } = await sharp(source, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    const color = await coverColor(await fromBase());
    const meta: CoverMeta = { color, sourceWidth: width ?? null, v: COLOR_VERSION };
    await fs.writeFile(metaFile(coversDir, hash), JSON.stringify(meta));
    metaCache.set(hash, meta);
  }
  for (const size of COVER_SIZES) {
    const out = coverFile(coversDir, hash, size);
    try {
      await fs.access(out);
      continue;
    } catch {
      // not cached yet
    }
    // Two books with the same cover can be imported at once; each writes its own temp file, and
    // whichever rename lands last leaves a whole file behind.
    const tmp = `${out}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try {
      const img = await fromBase();
      await (size === LARGEST ? img : img.resize(size, size)).webp({ quality: 82 }).toFile(tmp);
      await fs.rename(tmp, out);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }
  return hash;
}

/** cover.jpg / folder.jpg first, then any other image in the folder. */
export function pickCoverImage(imageNames: string[]): string | null {
  const preferred = ["cover", "folder", "front"];
  for (const stem of preferred) {
    const hit = imageNames.find((n) => n.toLowerCase().replace(/\.[^.]+$/, "") === stem);
    if (hit) return hit;
  }
  return [...imageNames].sort()[0] ?? null;
}
