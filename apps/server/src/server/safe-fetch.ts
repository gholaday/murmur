import dns from "node:dns/promises";
import net from "node:net";
import { env } from "./env";
import { HttpError } from "./http";

// Fetching addresses people give Murmur (podcast feeds, their audio and artwork, a cover URL).
// Left alone, fetch would happily ask the server's own network: Murmur itself, the video add-on,
// a cloud box's metadata address. So the host is looked up first and anything inside is refused,
// each redirect is checked the same way, and bodies are read up to a cap.

const MAX_REDIRECTS = 5;

/** Inside the server's own network: loopback, link-local (the cloud metadata address lives there), unspecified. */
function isLocal(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 127 || a === 0 || (a === 169 && b === 254);
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("::ffff:")) return isLocal(mappedV4(v6));
  return /^fe[89ab]/.test(v6);
}

/** A private LAN address: home servers live here, so these are refused only by default (FETCH_ALLOW_PRIVATE). */
function isPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) || a! >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivate(mappedV4(v6));
  return /^f[cd]/.test(v6);
}

/** `::ffff:1.2.3.4` or `::ffff:102:304` as dotted IPv4. */
function mappedV4(v6: string): string {
  const rest = v6.slice(7);
  if (net.isIPv4(rest)) return rest;
  const [hi = "0", lo = "0"] = rest.split(":");
  const h = Number.parseInt(hi, 16);
  const l = Number.parseInt(lo, 16);
  return `${h >> 8}.${h & 255}.${l >> 8}.${l & 255}`;
}

/** Refuses an address that points at the server itself or (unless allowed) its LAN. */
export async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new HttpError(400, "Only http and https addresses can be fetched.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) throw new HttpError(400, "That address points at the server itself.");
  let addresses: string[];
  if (net.isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await dns.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new HttpError(400, `Couldn't find the address ${host}.`);
    }
  }
  if (addresses.length === 0) throw new HttpError(400, `Couldn't find the address ${host}.`);
  if (addresses.some(isLocal)) throw new HttpError(400, "That address points at the server itself.");
  if (!env.fetchAllowPrivate && addresses.some(isPrivate)) {
    throw new HttpError(400, "That address is on the server's own network. Set FETCH_ALLOW_PRIVATE=true to allow it.");
  }
}

/**
 * `fetch` for an address someone gave Murmur: the host is checked first, and so is every redirect.
 * Everything else about the request is the caller's.
 */
export async function safeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let current = new URL(url);
  let method = init.method ?? "GET";
  for (let hop = 0; ; hop++) {
    await assertPublicHost(current);
    const res = await fetch(current, { ...init, method, redirect: "manual" });
    const location = res.headers.get("location");
    if (![301, 302, 303, 307, 308].includes(res.status) || !location) return res;
    await res.body?.cancel();
    if (hop >= MAX_REDIRECTS) throw new HttpError(502, "That address redirects too many times.");
    current = new URL(location, current);
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) method = "GET";
  }
}

/** The whole body, or an error once it passes `maxBytes`, whatever the headers said. */
export async function readCapped(res: Response, maxBytes: number, what = "That file"): Promise<Buffer> {
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new HttpError(413, `${what} is too large.`);
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > maxBytes) {
      await res.body.cancel().catch(() => undefined);
      throw new HttpError(413, `${what} is too large.`);
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
