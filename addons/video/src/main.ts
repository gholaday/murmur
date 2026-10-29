import http from "node:http";
import {
  VIDEO_OWNER_HEADER,
  type VideoAddonHealth,
  videoDownloadStartSchema,
  videoFileSchema,
  videoStillSchema,
  videoStreamStartSchema,
} from "@murmur/shared";
import { cancelDownload, downloadCount, downloadFile, initDownloads, startDownload, stopAllDownloads } from "./downloads";
import { canToneMap, encoder } from "./encoders";
import { env } from "./env";
import { ffmpegAvailable, grabStill, probeVideo } from "./ffmpeg";
import { fromInside, HttpError, libraryFile, readJson, refuseProxied, requireSecret, sendError, sendFile, sendJson } from "./http";
import { createLogger, errorMessage } from "./log";
import { endStream, initStreams, masterPlaylist, startStream, stopAllStreams, streamCount, streamFilePath, streamMimeType } from "./streams";

// murmur-video: Murmur's video add-on. It owns ffmpeg, reading files for the scan and making
// streams and downloads; Murmur keeps the library, the database and the players, and passes the
// bytes through. Every request carries the add-on secret, except Docker's health check from inside
// the container, and nothing that came through a proxy is answered.

const log = createLogger("video");

const owner = (req: http.IncomingMessage) => {
  const value = req.headers[VIDEO_OWNER_HEADER];
  if (typeof value !== "string" || !value) throw new HttpError(400, "Missing owner.");
  return value;
};

/** A file Murmur named that isn't here means the folder isn't mounted at the same path in both. */
function notMounted(err: unknown): never {
  if ((err as NodeJS.ErrnoException).code === "ENOENT" || /No such file/i.test(errorMessage(err))) {
    throw new HttpError(404, "The video add-on can't see this file. Mount the folder at the same path in both containers.");
  }
  throw new HttpError(422, errorMessage(err));
}

async function health(): Promise<VideoAddonHealth> {
  const ffmpeg = await ffmpegAvailable();
  return {
    ffmpeg,
    encoder: ffmpeg ? await encoder() : "cpu",
    toneMap: ffmpeg ? await canToneMap() : false,
    streams: streamCount(),
    downloads: downloadCount(),
    version: env.version,
  };
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", "http://addon");
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method ?? "GET";

  refuseProxied(req);
  // Docker's health check asks from inside the container without the secret; everyone else needs it.
  if (!(method === "GET" && url.pathname === "/health" && fromInside(req))) requireSecret(req);
  if (method === "GET" && url.pathname === "/health") return sendJson(res, 200, await health());

  if (method === "POST" && url.pathname === "/probe") {
    const { file } = await readJson(req, videoFileSchema);
    return sendJson(res, 200, await probeVideo(libraryFile(file)).catch(notMounted));
  }
  if (method === "POST" && url.pathname === "/still") {
    const { file, durationSec, hdr } = await readJson(req, videoStillSchema);
    const jpeg = await grabStill(libraryFile(file), durationSec, hdr).catch(notMounted);
    res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": jpeg.length });
    return void res.end(jpeg);
  }

  if (parts[0] === "streams") {
    if (method === "POST" && parts.length === 1) {
      const body = await readJson(req, videoStreamStartSchema);
      return sendJson(res, 200, await startStream(body.owner, { ...body.src, file: libraryFile(body.src.file) }, body.start));
    }
    const [, id, file] = parts;
    if (method === "DELETE" && id && !file) {
      endStream(owner(req), id);
      return sendJson(res, 200, { ok: true });
    }
    if ((method === "GET" || method === "HEAD") && id && file) {
      if (file === "master.m3u8") {
        const body = masterPlaylist(owner(req), id);
        res.writeHead(200, { "Content-Type": streamMimeType(file), "Cache-Control": "no-store" });
        return void res.end(body);
      }
      // The playlist grows while ffmpeg works, so it's never cached; a piece never changes.
      const cache = file.endsWith(".m3u8") ? "no-store" : "private, max-age=3600, no-transform";
      return sendFile(req, res, await streamFilePath(owner(req), id, file), streamMimeType(file), cache);
    }
  }

  if (parts[0] === "downloads") {
    if (method === "POST" && parts.length === 1) {
      const body = await readJson(req, videoDownloadStartSchema);
      return sendJson(res, 200, startDownload(body.owner, { ...body.src, file: libraryFile(body.src.file) }));
    }
    const [, id] = parts;
    if ((method === "GET" || method === "HEAD") && id) {
      return sendFile(req, res, downloadFile(owner(req), id), "video/mp4", "private, no-transform");
    }
    if (method === "DELETE" && id) {
      cancelDownload(owner(req), id);
      return sendJson(res, 200, { ok: true });
    }
  }

  throw new HttpError(404, "Not found.");
}

if (!env.addonSecret) log.warn("ADDON_SECRET isn't set, so Murmur can't use the video add-on");
initStreams();
initDownloads();

const server = http.createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    if (!(err instanceof HttpError)) log.error("request failed", { method: req.method, url: req.url, error: errorMessage(err) });
    sendError(res, err);
  });
});
server.listen(env.port, () => log.info("video add-on listening", { port: env.port, cache: env.cacheDir, version: env.version }));

const shutdown = () => {
  stopAllStreams();
  stopAllDownloads();
  server.close();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.once("exit", () => {
  stopAllStreams();
  stopAllDownloads();
});
