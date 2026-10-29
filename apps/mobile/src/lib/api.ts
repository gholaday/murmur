import { type ApiError, CHANGES_HEADER, type HealthProbeDto } from "@murmur/shared/client";

// The signed-in server and token live here so non-React code (player, downloads, sync)
// can call the API too. session.tsx keeps them in step with what's stored.

let serverUrl: string | null = null;
let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function configureApi(opts: { serverUrl: string | null; token: string | null; onUnauthorized?: () => void }) {
  serverUrl = opts.serverUrl;
  token = opts.token;
  if (opts.onUnauthorized) onUnauthorized = opts.onUnauthorized;
}

let noteChanges: ((token: string | null) => void) | null = null;

/** Hands the change counts on every answer to the live-changes poller (lib/changes.ts). */
export function onChangesHeader(fn: (token: string | null) => void) {
  noteChanges = fn;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Absolute URL for a server path, e.g. a cover or stream. */
export function absolute(path: string): string {
  if (!serverUrl) throw new Error("Not signed in.");
  return `${serverUrl}${path}`;
}

/** Headers for requests made outside fetch, like image loads, streams and downloads. */
export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const TIMEOUT_MS = 15_000;

// The last ETag and body per GET path, so refetching an unchanged list (library, podcasts,
// Up Next) comes back as an empty 304. React Native's fetch has no HTTP cache of its own.
// Only the most recently used paths are kept, so the bodies don't pile up over a session.
const etags = new Map<string, { etag: string; data: unknown }>();
const MAX_ETAGS = 100;

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const method = init?.method ?? "GET";
  const cached = method === "GET" ? etags.get(path) : undefined;
  let res: Response;
  try {
    res = await fetch(absolute(path), {
      method,
      headers: {
        ...authHeaders(),
        Accept: "application/json",
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cached ? { "If-None-Match": cached.etag } : {}),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error("Can't reach your Murmur server.");
  }
  noteChanges?.(res.headers.get(CHANGES_HEADER));
  if (res.status === 401) {
    onUnauthorized?.();
    throw new HttpError(401, "Signed out. Sign in again.");
  }
  if (res.status === 304 && cached) {
    etags.delete(path);
    etags.set(path, cached);
    return cached.data as T;
  }
  const data = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok) throw new HttpError(res.status, (data as ApiError | null)?.error ?? `Request failed (${res.status}).`);
  const etag = method === "GET" ? res.headers.get("etag") : null;
  if (method === "GET") etags.delete(path);
  if (etag) {
    etags.set(path, { etag, data });
    // A Map keeps insertion order, so the first key is the one used longest ago.
    if (etags.size > MAX_ETAGS) etags.delete(etags.keys().next().value!);
  }
  return data as T;
}

/** Forgets saved ETags, e.g. on sign-out, so another account never gets this one's data. */
export function clearEtags() {
  etags.clear();
}

/** Addresses on the home network, which usually serve plain http. */
const LOCAL_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^./:]+(\.local)?(:|$))/i;

/**
 * Turns what someone typed into a server base URL and drops trailing slashes. Without a
 * scheme, local addresses get http:// and everything else https://.
 * "murmur.example.com/" -> "https://murmur.example.com", "192.168.1.5:3000" -> "http://192.168.1.5:3000".
 */
export function normalizeServerUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) url = `${LOCAL_HOST.test(url) ? "http" : "https"}://${url}`;
  return url;
}

/** Checks that a URL really is a Murmur server before asking for a password. */
export async function probeServer(url: string): Promise<HealthProbeDto> {
  let res: Response;
  try {
    res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new Error("Couldn't reach that address. Check the URL and your connection.");
  }
  const body = (await res.json().catch(() => null)) as Partial<HealthProbeDto> | null;
  if (!res.ok && res.status >= 500) throw new Error(`The server answered with an error (${res.status}). Try again in a moment.`);
  if (!body || typeof body.version !== "string") throw new Error("That address isn't a Murmur server.");
  return body as HealthProbeDto;
}
