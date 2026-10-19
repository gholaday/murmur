import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import { coverFile, coverMeta, storeCover } from "./covers";

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
    // sharp rounds the dominant colour into bins, so check it's the blue we drew, roughly.
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(meta!.color.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(g!);
    expect(g).toBeGreaterThan(r!);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
