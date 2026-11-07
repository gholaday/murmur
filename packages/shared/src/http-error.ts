import type { ZodError } from "zod";

// How Murmur's routes and the video add-on answer an error: `{ error }` JSON with the status, so
// Murmur can pass the add-on's errors on to the player as they are.

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

/** A 400's text for a request that failed its schema: the field, then what's wrong with it. */
export function invalidRequestText(err: ZodError): string {
  const issue = err.issues[0];
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  return `${where}${issue?.message ?? "Invalid request."}`;
}
