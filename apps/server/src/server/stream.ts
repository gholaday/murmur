import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { parseRange } from "@murmur/shared";
import { HttpError } from "./http";
import { safeFetch } from "./safe-fetch";

/** Joins a stored relative path onto the library root, refusing anything that escapes it. */
export function resolveInside(root: string, relPath: string): string {
  const full = path.resolve(/*turbopackIgnore: true*/ root, relPath);
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new HttpError(400, "Invalid file path.");
  return full;
}

/**
 * Streams a file byte for byte with range support (no transcoding), so seeking in a
 * 20-hour book is instant and costs almost no CPU.
 */
export async function streamFile(req: Request, file: string, mimeType: string): Promise<Response> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    throw new HttpError(404, "The file is missing on the server. A rescan will fix the library.");
  }
  const size = stat.size;
  const range = parseRange(req.headers.get("range"), size);
  const baseHeaders: Record<string, string> = {
    "Content-Type": mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600, no-transform",
    "Last-Modified": stat.mtime.toUTCString(),
  };

  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...baseHeaders, "Content-Range": `bytes */${size}` } });
  }
  if (req.method === "HEAD") {
    return new Response(null, { status: 200, headers: { ...baseHeaders, "Content-Length": String(size) } });
  }

  const { start, end } = range ?? { start: 0, end: size - 1 };
  const nodeStream = fs.createReadStream(file, { start, end, highWaterMark: 256 * 1024 });
  req.signal.addEventListener("abort", () => nodeStream.destroy(), { once: true });
  const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  const headers = { ...baseHeaders, "Content-Length": String(end - start + 1) };
  if (range) {
    return new Response(body, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}` } });
  }
  return new Response(body, { status: 200, headers });
}

/** What a growing-file stream needs from a download in progress. */
export interface GrowingFile {
  size: number | null;
  done: number;
  finished: boolean;
  failed: string | null;
  wait: (ms: number) => Promise<void>;
}

/** Give up on a growing file if it gains nothing for this long. */
const GROWING_STALL_MS = 60_000;

/**
 * Streams a file that is still downloading, so playback can start at once and everyone
 * hears the same copy. A range past what's on disk waits for the download to get there
 * (it runs far faster than playback) rather than fetching that part from the publisher,
 * whose copy may carry different ads.
 */
export function streamGrowing(req: Request, file: string, download: GrowingFile, mimeType: string): Response {
  const size = download.size!;
  const range = parseRange(req.headers.get("range"), size);
  const baseHeaders: Record<string, string> = { "Content-Type": mimeType, "Accept-Ranges": "bytes", "Cache-Control": "private, no-transform" };
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...baseHeaders, "Content-Range": `bytes */${size}` } });
  }
  if (req.method === "HEAD") {
    return new Response(null, { status: 200, headers: { ...baseHeaders, "Content-Length": String(size) } });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const nodeStream = Readable.from(readGrowing(file, download, start, end, req.signal));
  req.signal.addEventListener("abort", () => nodeStream.destroy(), { once: true });
  const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  const headers = { ...baseHeaders, "Content-Length": String(end - start + 1) };
  if (range) {
    return new Response(body, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}` } });
  }
  return new Response(body, { status: 200, headers });
}

async function* readGrowing(file: string, download: GrowingFile, start: number, end: number, signal: AbortSignal) {
  const handle = await fs.promises.open(file, "r");
  try {
    const buf = Buffer.alloc(256 * 1024);
    let pos = start;
    let lastProgress = Date.now();
    while (pos <= end && !signal.aborted) {
      const onDisk = download.finished ? (download.size ?? download.done) : download.done;
      if (pos >= onDisk) {
        if (download.failed) throw new Error(download.failed);
        if (Date.now() - lastProgress > GROWING_STALL_MS) throw new Error("The download stalled.");
        await download.wait(5_000);
        continue;
      }
      const want = Math.min(buf.length, Math.min(end + 1, onDisk) - pos);
      const { bytesRead } = await handle.read(buf, 0, want, pos);
      if (bytesRead === 0) {
        await download.wait(1_000);
        continue;
      }
      pos += bytesRead;
      lastProgress = Date.now();
      yield Buffer.from(buf.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
}

const PASS_THROUGH_HEADERS =["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

/**
 * Relays a publisher's audio with range support. Enclosure URLs usually chain through
 * tracking redirects that browser blockers refuse, so the server fetches them instead.
 */
export async function proxyStream(req: Request, url: string, mimeType: string, userAgent: string): Promise<Response> {
  // identity keeps Content-Length/Range byte-accurate (fetch would silently decompress).
  const headers: Record<string, string> = { "User-Agent": userAgent, "Accept-Encoding": "identity" };
  const range = req.headers.get("range");
  if (range) headers.Range = range;
  let upstream: Response;
  try {
    upstream = await safeFetch(url, { method: req.method === "HEAD" ? "HEAD" : "GET", headers, signal: req.signal });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, "Couldn't reach the podcast's audio host.");
  }
  if (!upstream.ok && upstream.status !== 416) {
    await upstream.body?.cancel();
    throw new HttpError(502, `The podcast's audio host answered ${upstream.status}.`);
  }
  const out = new Headers({ "Cache-Control": "private, no-transform" });
  for (const name of PASS_THROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  // Hosts sometimes label audio as octet-stream, which some players refuse. Only an audio type
  // of theirs is kept, so nothing relayed is ever served as a page.
  const type = out.get("content-type");
  if (!type || !/^audio\//.test(type)) out.set("content-type", mimeType);
  out.set("X-Content-Type-Options", "nosniff");
  return new Response(req.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: out });
}
