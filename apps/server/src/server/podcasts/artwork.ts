import crypto from "node:crypto";
import type { Sqlite } from "../db";
import { castKey } from "../cast";
import { HttpError } from "../http";
import { readCapped, safeFetch } from "../safe-fetch";

// Search results and previews show artwork from Apple and the podcast's publisher before Murmur
// has its own copy. Loading it in the browser or the app would tell those hosts who's looking and
// what they search for, so the server fetches it instead. Links are signed, so only artwork the
// server itself handed out can be fetched this way, not any address someone types in.

const PATH = "/api/podcasts/artwork";
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

function signature(sqlite: Sqlite, url: string): string {
  // The cast key with its own label, so a signature here can never pass as a cast token.
  return crypto.createHmac("sha256", castKey(sqlite)).update(`podcast-artwork\0${url}`).digest("base64url");
}

/** A server link to an outside image, or null when there's none. */
export function artworkLink(sqlite: Sqlite, url: string | null): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return `${PATH}?u=${encodeURIComponent(url)}&s=${signature(sqlite, url)}`;
}

/** Fetches the image behind a signed link: at most 5 MB, and only an image. */
export async function fetchArtwork(sqlite: Sqlite, url: string, sig: string): Promise<{ body: Buffer; type: string }> {
  const want = Buffer.from(signature(sqlite, url));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) throw new HttpError(404, "Not found.");
  const res = await safeFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((err: unknown) => {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, "Couldn't load the artwork.");
  });
  const type = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!res.ok || !type.startsWith("image/") || type === "image/svg+xml") {
    await res.body?.cancel().catch(() => undefined);
    throw new HttpError(502, "Couldn't load the artwork.");
  }
  return { body: await readCapped(res, MAX_BYTES, "The artwork"), type };
}
