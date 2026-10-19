import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp, { type OutputInfo } from "sharp";

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
  /** Dominant colour as #rrggbb, used to tint page headers. */
  color: string;
  /** Width of the original image, when known; Match only replaces a cover with a larger one. */
  sourceWidth: number | null;
}

const metaCache = new Map<string, CoverMeta | null>();

function metaFile(coversDir: string, hash: string): string {
  return path.join(coversDir, `${hash}.json`);
}

async function dominantColor(image: Buffer | string): Promise<string> {
  const { dominant } = await sharp(image, { failOn: "none" }).stats();
  return `#${[dominant.r, dominant.g, dominant.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Colour and size details for a stored cover. Covers stored before this existed get
 * their colour worked out from the small rendition on first use.
 */
export async function coverMeta(coversDir: string, hash: string): Promise<CoverMeta | null> {
  if (metaCache.has(hash)) return metaCache.get(hash) ?? null;
  let meta: CoverMeta | null = null;
  try {
    meta = JSON.parse(await fs.readFile(metaFile(coversDir, hash), "utf8")) as CoverMeta;
  } catch {
    try {
      meta = { color: await dominantColor(coverFile(coversDir, hash, 200)), sourceWidth: null };
      await fs.writeFile(metaFile(coversDir, hash), JSON.stringify(meta));
    } catch {
      meta = null;
    }
  }
  metaCache.set(hash, meta);
  return meta;
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
export async function storeCover(coversDir: string, source: Buffer): Promise<string> {
  const hash = crypto.createHash("sha1").update(source).digest("hex").slice(0, 16);
  await fs.mkdir(coversDir, { recursive: true });

  // Decode the source once, straight down to the largest served size; podcast artwork is
  // often 3000px, and decoding that for every step costs far more memory than the outputs.
  let base: { data: Buffer; info: OutputInfo } | null = null;
  const fromBase = async () => {
    base ??= await sharp(source, { failOn: "none" })
      .rotate()
      .resize(LARGEST, LARGEST, { fit: "cover", withoutEnlargement: false })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = base.info;
    return sharp(base.data, { raw: { width, height, channels } });
  };

  if (!(await coverMeta(coversDir, hash))?.sourceWidth) {
    // Reads only the header.
    const { width } = await sharp(source, { failOn: "none" }).metadata();
    const { dominant } = await (await fromBase()).stats();
    const color = `#${[dominant.r, dominant.g, dominant.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    const meta: CoverMeta = { color, sourceWidth: width ?? null };
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
    const tmp = `${out}.${process.pid}.tmp`;
    const img = await fromBase();
    await (size === LARGEST ? img : img.resize(size, size)).webp({ quality: 82 }).toFile(tmp);
    await fs.rename(tmp, out);
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
