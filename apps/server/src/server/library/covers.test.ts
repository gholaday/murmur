import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import { coverColor, coverFile, coverMeta, storeCover } from "./covers";

it("stores a large, non-square cover at every size with its colour and source width", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "murmur-covers-"));
  try {
    const source = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#204080" } })
      .jpeg()
      .toBuffer();
    const hash = await storeCover(dir, source);

    for (const size of [200, 600] as const) {
      const out = await sharp(coverFile(dir, hash, size)).metadata();
      expect([out.width, out.height]).toEqual([size, size]);
    }
    const meta = await coverMeta(dir, hash);
    expect(meta?.sourceWidth).toBe(3000);
    // Resizing and JPEG shift the colour a little, so check it's the blue we drew, roughly.
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(meta!.color.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(g!);
    expect(g).toBeGreaterThan(r!);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

it("tints a cover by its colour, not by the white lettering on it", async () => {
  // A green cover with a white band over 40% of it, like a big title.
  const white = await sharp({ create: { width: 100, height: 40, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const image = sharp({ create: { width: 100, height: 100, channels: 3, background: "#10a040" } }).composite([
    { input: white, top: 30, left: 0 },
  ]);
  const color = await coverColor(sharp(await image.png().toBuffer()));
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
  expect(g).toBeGreaterThan(r! + 60);
  expect(g).toBeGreaterThan(b! + 60);
});
