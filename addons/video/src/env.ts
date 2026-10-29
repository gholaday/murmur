import path from "node:path";

const intEnv = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const env = {
  /** Its own name, so the add-on never picks up Murmur's PORT when the two run side by side. */
  port: intEnv("VIDEO_PORT", 3001),
  /** The same secret Murmur has; every request carries it as a bearer token. */
  addonSecret: process.env.ADDON_SECRET ?? "",
  version: process.env.MURMUR_VERSION ?? "dev",
  ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",
  ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
  /** GPU video conversion: auto tries nvenc, qsv, vaapi, amf and videotoolbox in turn; off is the CPU only; or name one. */
  watchHardware: (process.env.WATCH_HW?.trim().toLowerCase() || "auto") as "auto" | "off" | "nvenc" | "qsv" | "vaapi" | "amf" | "videotoolbox",
  /** The render node VAAPI encodes on. */
  vaapiDevice: process.env.VAAPI_DEVICE?.trim() || "/dev/dri/renderD128",
  /** Streams' pieces while they're watched, and downloads until they're fetched. Nothing stays. */
  cacheDir: path.resolve(process.env.CACHE_DIR ?? "/cache"),
};
