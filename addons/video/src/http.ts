import crypto from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { cameThroughProxy, parseRange } from "@murmur/shared";
import { ZodError, type ZodType } from "zod";
import { env } from "./env";

// Just enough HTTP for the add-on's few endpoints: errors as `{ error }` JSON with the right status,
// the same as Murmur's own routes, so Murmur can pass them on to the player as they are.

export class HttpError extends Error {
  override readonly name = "HttpError";
  constructor(
    readonly status: number,
    message: string,
    /** Extra response headers, like `Retry-After` on a 503. */
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export function sendJson(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

export function sendError(res: ServerResponse, err: unknown) {
  if (res.headersSent) return void res.destroy();
  if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message }, err.headers);
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    return sendJson(res, 400, { error: `${issue?.path.join(".") ?? ""}: ${issue?.message ?? "Invalid request."}` });
  }
  sendJson(res, 500, { error: err instanceof Error ? err.message : "Something went wrong in the video add-on." });
}

/** Docker's own health check, from inside the container. */
export const fromInside = (req: IncomingMessage) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "");

/**
 * Anything that passed through a proxy or tunnel came from outside the stack: Murmur calls the
 * add-on directly and sends no forwarding headers at all, so any `x-forwarded-*` counts here too.
 */
export function refuseProxied(req: IncomingMessage) {
  const header = (name: string) => {
    const value = req.headers[name];
    return Array.isArray(value) ? value.join(",") : value;
  };
  if (cameThroughProxy(header) || Object.keys(req.headers).some((name) => name.startsWith("x-forwarded-"))) {
    throw new HttpError(404, "Not found.");
  }
}

/** Only Murmur, holding the shared secret, gets in. */
export function requireSecret(req: IncomingMessage) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(env.addonSecret);
  if (!env.addonSecret || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, "Wrong add-on secret.");
}

export async function readJson<T>(req: IncomingMessage, schema: ZodType<T>): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
  return schema.parse(raw);
}

/** A file with range support, for stream pieces and finished downloads. */
export async function sendFile(req: IncomingMessage, res: ServerResponse, file: string, mimeType: string, cache: string) {
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat) throw new HttpError(404, "That file is gone.");
  const size = stat.size;
  const range = parseRange(req.headers.range ?? null, size);
  const base = { "Content-Type": mimeType, "Accept-Ranges": "bytes", "Cache-Control": cache };
  if (range === "unsatisfiable") {
    res.writeHead(416, { ...base, "Content-Range": `bytes */${size}` });
    return void res.end();
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const headers: Record<string, string | number> = { ...base, "Content-Length": end - start + 1 };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === "HEAD") return void res.end();
  const stream = fs.createReadStream(file, { start, end, highWaterMark: 256 * 1024 });
  res.once("close", () => stream.destroy());
  stream.pipe(res);
}
