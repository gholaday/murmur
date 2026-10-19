import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Trace files from the monorepo root so the standalone build includes workspace packages.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  transpilePackages: ["@murmur/shared"],
  // Native modules must be loaded from node_modules at runtime, not bundled.
  serverExternalPackages: ["better-sqlite3", "sharp", "@node-rs/argon2"],
  poweredByHeader: false,
  images: { unoptimized: true },
};

export default nextConfig;
