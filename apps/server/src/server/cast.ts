import crypto from "node:crypto";
import type { Sqlite } from "./db";
import { readState, writeState } from "./settings";

/**
 * Links a Chromecast can open without signing in. It fetches media straight from Murmur and has
 * no session, so a cast gets a token for a few path prefixes (one item's stream and its cover),
 * read-only, for a few hours. The token rides in the path (`/api/cast/<token>/api/stream/...`)
 * rather than the query, because an HLS playlist's pieces are relative links that drop the query.
 */

/** Long enough for a long movie with a pause or two. */
export const CAST_TOKEN_MS = 12 * 60 * 60 * 1000;
export const CAST_HEADER = "x-murmur-cast";
/** `/api/cast/<token>/<rest>`: the proxy serves `/<rest>` with the token in CAST_HEADER. */
export const CAST_PATH = /^\/api\/cast\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(\/api\/.*)$/;

/** What a cast may open: streams and pictures, never the rest of the API. Each is a prefix. */
const ALLOWED = [
  /^\/api\/stream\/book\/[\w-]+\/$/,
  /^\/api\/stream\/(episode|track|video)\/[\w-]+$/,
  /^\/api\/watch\/streams\/[\w-]+\/$/,
  /^\/api\/(books|podcasts)\/[\w-]+\/cover$/,
  /^\/api\/music\/albums\/[\w-]+\/cover$/,
  /^\/api\/watch\/(movies|shows)\/[\w-]+\/(poster|backdrop)$/,
  /^\/api\/watch\/videos\/[\w-]+\/still$/,
];

export const castPrefixAllowed = (prefix: string) => ALLOWED.some((re) => re.test(prefix));

interface Payload {
  /** The user the cast plays as. */
  u: number;
  /** Path prefixes it may open. */
  s: string[];
  /** Expiry, ms since the epoch. */
  e: number;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (key: Buffer, data: string) => crypto.createHmac("sha256", key).update(data).digest("base64url");

/** The server's own signing key, made once and kept in the database so casts survive a restart. */
export function castKey(sqlite: Sqlite): Buffer {
  const stored = readState<string>(sqlite, "castKey");
  if (stored) return Buffer.from(stored, "base64url");
  const key = crypto.randomBytes(32);
  writeState(sqlite, "castKey", key.toString("base64url"));
  return key;
}

export function signCastToken(key: Buffer, userId: number, prefixes: string[], now = Date.now()): string {
  const payload = b64(JSON.stringify({ u: userId, s: prefixes, e: now + CAST_TOKEN_MS } satisfies Payload));
  return `${payload}.${sign(key, payload)}`;
}

/** The user a token plays as, if it is genuine, unexpired and covers this read of this path. */
export function checkCastToken(key: Buffer, token: string, method: string, path: string, now = Date.now()): number | null {
  if (method !== "GET" && method !== "HEAD") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = Buffer.from(sign(key, payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  let p: Payload;
  try {
    p = JSON.parse(Buffer.from(payload, "base64url").toString()) as Payload;
  } catch {
    return null;
  }
  if (typeof p.e !== "number" || p.e < now || !Array.isArray(p.s) || !Number.isInteger(p.u)) return null;
  // `..` never reaches here (URLs are normalised), but a prefix match must not be fooled by one.
  if (path.includes("..")) return null;
  const covers = (prefix: unknown) =>
    typeof prefix === "string" && castPrefixAllowed(prefix) && (prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix);
  return p.s.some(covers) ? p.u : null;
}
