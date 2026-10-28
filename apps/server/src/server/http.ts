import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { createLogger, errorMessage } from "./log";

const log = createLogger("http");

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

/**
 * Services created at boot live in Next's instrumentation bundle, which has its own copy
 * of this module, so `instanceof` fails across bundles. Match by shape instead.
 */
function isHttpError(err: unknown): err is HttpError {
  return err instanceof Error && err.name === "HttpError" && typeof (err as HttpError).status === "number";
}

/** Rejects un-awaited promises at compile time; they would serialise as `{}`. */
type NotPromise<T> = T extends PromiseLike<unknown> ? never : T;

export function json<T>(data: NotPromise<T>, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

/**
 * JSON with a weak ETag. Clients that already hold the same data get an empty
 * 304, which keeps library refreshes cheap on slow connections.
 */
export function jsonWithEtag<T>(req: Request, data: NotPromise<T>): Response {
  const body = JSON.stringify(data);
  const etag = `W/"${crypto.createHash("sha1").update(body).digest("base64url").slice(0, 22)}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { ...headers, "Content-Type": "application/json" } });
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
      if (err instanceof ZodError) {
        const issue = err.issues[0];
        const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
        return json({ error: `${where}${issue?.message ?? "Invalid request."}` }, { status: 400 });
      }
      log.error("unhandled error", { method: req.method, url: req.url, error: errorMessage(err) });
      return json({ error: "Something went wrong on the server." }, { status: 500 });
    }
  };
}
