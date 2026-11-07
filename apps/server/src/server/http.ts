import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { HttpError, invalidRequestText } from "@murmur/shared";
import { ZodError, type ZodType } from "zod";
import { createLogger, errorMessage } from "./log";

const log = createLogger("http");

export { HttpError };

/**
 * Services created at boot live in Next's instrumentation bundle, which has its own copy
 * of this module, so `instanceof` fails across bundles. Match by shape instead.
 */
export function isHttpError(err: unknown): err is HttpError {
  return err instanceof Error && err.name === "HttpError" && typeof (err as HttpError).status === "number";
}

/** Below this, gzip saves too little to be worth the work. */
const GZIP_FROM_CHARS = 1024;

/** Rejects un-awaited promises at compile time; they would serialise as `{}`. */
type NotPromise<T> = T extends PromiseLike<unknown> ? never : T;

export function json<T>(data: NotPromise<T>, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

/**
 * JSON with a weak ETag. Clients that already hold the same data get an empty
 * 304, which keeps library refreshes cheap on slow connections. Next only compresses pages, so
 * anything big is gzipped here; a list of 1,000 books goes from 350 KB to 24 KB.
 */
export function jsonWithEtag<T>(req: Request, data: NotPromise<T>): Response {
  const body = JSON.stringify(data);
  const etag = `W/"${crypto.createHash("sha1").update(body).digest("base64url").slice(0, 22)}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache", Vary: "Accept-Encoding" };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  const type = { ...headers, "Content-Type": "application/json" };
  if (body.length < GZIP_FROM_CHARS || !/\bgzip\b/.test(req.headers.get("accept-encoding") ?? "")) return new Response(body, { headers: type });
  return new Response(gzipSync(body), { headers: { ...type, "Content-Encoding": "gzip" } });
}

export async function readJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
  return schema.parse(raw);
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route handler so errors always come back as `{ error }` JSON with the right status. */
export function route<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (isHttpError(err)) return json({ error: err.message }, { status: err.status, headers: err.headers });
      if (err instanceof ZodError) return json({ error: invalidRequestText(err) }, { status: 400 });
      // A cast link carries its token in the path; it stays out of the log.
      const url = req.url.replace(/\/api\/cast\/[^/]+/, "/api/cast/…");
      log.error("unhandled error", { method: req.method, url, error: errorMessage(err) });
      return json({ error: "Something went wrong on the server." }, { status: 500 });
    }
  };
}

/** Longest text a search box may send. */
const MAX_QUERY_CHARS = 200;

/** A search box's text from the URL, or undefined when it's missing; refuses one past MAX_QUERY_CHARS. */
export function queryText(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name) ?? undefined;
  if (value !== undefined && value.length > MAX_QUERY_CHARS) throw new HttpError(400, "That search is too long.");
  return value;
}
