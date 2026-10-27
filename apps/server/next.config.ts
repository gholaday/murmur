import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Trace files from the monorepo root so the standalone build includes workspace packages.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  transpilePackages: ["@murmur/shared"],
  // Native modules must be loaded from node_modules at runtime, not bundled.
  serverExternalPackages: ["better-sqlite3", "sharp", "@node-rs/argon2", "music-metadata", "strtok3"],
  poweredByHeader: false,
  // The release version, set while building the image, replaces process.env.MURMUR_VERSION in
  // the code. A container's own environment can't then report an older one.
  ...(process.env.MURMUR_VERSION ? { env: { MURMUR_VERSION: process.env.MURMUR_VERSION } } : {}),
  images: { unoptimized: true },
  // Renamed pages; keep old bookmarks working.
  redirects: async () => [
    { source: "/profile", destination: "/you", permanent: true },
    { source: "/settings", destination: "/you", permanent: true },
    { source: "/up-next", destination: "/listening", permanent: true },
  ],
};

export default nextConfig;
