import {
  addonAuthorization,
  addonVersionProblem,
  type ProbedVideo,
  VIDEO_OWNER_HEADER,
  VIDEO_PASS_THROUGH_HEADERS,
  videoAddonPaths as paths,
  type VideoAddonHealth,
  type VideoDownloadDto,
  type VideoSource,
  type VideoStatus,
  type VideoStreamStarted,
  type VideoSubtitlesDto,
} from "@murmur/shared";
import { Agent, fetch as undiciFetch } from "undici";
import { env } from "../env";
import { HttpError } from "../http";

// The video add-on (murmur-video) runs ffmpeg: it reads files for the scan, grabs stills and makes
// streams and downloads. This is Murmur's side of it. The add-on answers errors as `{ error }` with
// the right status, the same as Murmur's routes, so they're passed on as they are.

const UNREACHABLE = "The video add-on isn't reachable. Start murmur-video, with the same ADDON_SECRET as Murmur.";

async function call(path: string, init: RequestInit & { owner?: string } = {}): Promise<Response> {
  if (!env.addonSecret) throw new HttpError(503, env.addonSecretProblem ?? "Set ADDON_SECRET on Murmur and the video add-on to play movies and shows.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", addonAuthorization(env.addonSecret));
  if (init.owner) headers.set(VIDEO_OWNER_HEADER, init.owner);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  try {
    return await fetch(`${env.videoUrl}${path}`, { ...init, headers });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new HttpError(503, UNREACHABLE);
  }
}

/** The add-on's answer as JSON, or its error as an HttpError with the same status. */
async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    const retry = res.headers.get("retry-after");
    throw new HttpError(res.status, body?.error ?? `The video add-on answered ${res.status}.`, retry ? { "Retry-After": retry } : undefined);
  }
  return body as T;
}

const post = <T>(path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) }).then((r) => json<T>(r));

/** The add-on's state, or null when it can't be reached. */
export async function videoHealth(): Promise<VideoAddonHealth | null> {
  if (!env.addonSecret) return null;
  try {
    const res = await fetch(`${env.videoUrl}${paths.health}`, {
      headers: { Authorization: addonAuthorization(env.addonSecret) },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? ((await res.json()) as VideoAddonHealth) : null;
  } catch {
    return null;
  }
}

const ENCODER_NAME: Record<VideoAddonHealth["encoder"], string> = {
  nvenc: "an NVIDIA GPU",
  qsv: "Quick Sync",
  vaapi: "the GPU (VAAPI)",
  amf: "an AMD GPU",
  videotoolbox: "VideoToolbox",
  cpu: "the CPU",
};

/** What stops the add-on reading files (null when it can't be reached counts). */
function blocked(health: VideoAddonHealth | null): string | null {
  if (!env.addonSecret) return env.addonSecretProblem ?? "Set ADDON_SECRET on Murmur and the video add-on to read movies and shows.";
  if (!health) return UNREACHABLE;
  if (!health.ffmpeg) return "ffmpeg isn't working in the video add-on, so movies and shows can't be read.";
  return null;
}

/** Settings' Video row from the add-on's health (null when it can't be reached). */
export function videoStatus(health: VideoAddonHealth | null): VideoStatus {
  const problem = blocked(health) ?? addonVersionProblem("video", health?.version, env.version);
  return problem ? { problem } : { problem: null, working: `Working, converts video with ${ENCODER_NAME[health!.encoder]}` };
}

/** Why Watch can't read files right now, or null when the add-on is there with ffmpeg. Another major version is only reported, so scans still run. */
export const videoProblem = async (): Promise<string | null> => blocked(await videoHealth());

export const probeVideo = (file: string) => post<ProbedVideo>(paths.probe, { file });

/** A JPEG for the video's still; empty when no frame could be grabbed. */
export async function grabStill(file: string, durationSec: number, hdr: boolean): Promise<Buffer> {
  const res = await call(paths.still, { method: "POST", body: JSON.stringify({ file, durationSec, hdr }) });
  if (!res.ok) await json(res);
  return Buffer.from(await res.arrayBuffer());
}

/** Reading a whole film can pass the five minutes fetch waits for an answer by default. */
const patient = new Agent({ headersTimeout: 15 * 60_000, bodyTimeout: 15 * 60_000 });

/** Text subtitle tracks of a file as WebVTT, by index, all from one read of it. */
export async function extractSubtitles(file: string, tracks: number[]): Promise<VideoSubtitlesDto> {
  if (!env.addonSecret) throw new HttpError(503, env.addonSecretProblem ?? "Set ADDON_SECRET on Murmur and the video add-on to read subtitles.");
  const res = await undiciFetch(`${env.videoUrl}${paths.subtitles}`, {
    method: "POST",
    headers: { Authorization: addonAuthorization(env.addonSecret), "Content-Type": "application/json" },
    body: JSON.stringify({ file, tracks }),
    dispatcher: patient,
  }).catch(() => {
    throw new HttpError(503, UNREACHABLE);
  });
  return json<VideoSubtitlesDto>(res as unknown as Response);
}

export const startStream = (owner: string, src: VideoSource, start: number) => post<VideoStreamStarted>(paths.streams, { owner, src, start });

export async function endStream(owner: string, id: string) {
  await json(await call(paths.stream(id), { method: "DELETE", owner }));
}

export const startDownload = (owner: string, src: VideoSource) => post<VideoDownloadDto>(paths.downloads, { owner, src });

export async function cancelDownload(owner: string, id: string) {
  await json(await call(paths.download(id), { method: "DELETE", owner }));
}

/** A stream file or download from the add-on, passed through to the player byte for byte, ranges and errors included. */
async function relay(req: Request, path: string, owner: string): Promise<Response> {
  const range = req.headers.get("range");
  const res = await call(path, { method: req.method === "HEAD" ? "HEAD" : "GET", owner, headers: range ? { Range: range } : {}, signal: req.signal });
  const headers = new Headers();
  for (const name of VIDEO_PASS_THROUGH_HEADERS) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(req.method === "HEAD" ? null : res.body, { status: res.status, headers });
}

export const streamResponse = (req: Request, owner: string, id: string, file: string) => relay(req, paths.streamFile(id, file), owner);

export const downloadResponse = (req: Request, owner: string, id: string) => relay(req, paths.download(id), owner);
