import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { env } from "./env";
import { HttpError } from "./http";

// Fetching addresses people give Murmur (podcast feeds, their audio and artwork, a cover URL).
// Left alone, fetch would happily ask the server's own network: Murmur itself, the video add-on,
// a cloud box's metadata address. So the host is looked up first and anything inside is refused,
// each redirect is checked the same way, and bodies are read up to a cap. The connection itself
// goes through a lookup that checks again, so a name whose record changes between the check and
// the connection (DNS rebinding) is refused where it counts.

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

/** Why a host at these addresses is refused, or null when it may be fetched. */
function refusal(host: string, addresses: string[]): HttpError | null {
  if (addresses.length === 0) return new HttpError(400, `Couldn't find the address ${host}.`);
  if (addresses.some(isLocal)) return new HttpError(400, "That address points at the server itself.");
  if (!env.fetchAllowPrivate && addresses.some(isPrivate)) {
    return new HttpError(400, "That address is on the server's own network. Set FETCH_ALLOW_PRIVATE=true to allow it.");
  }
  return null;
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
      addresses = (await dns.promises.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new HttpError(400, `Couldn't find the address ${host}.`);
    }
  }
  const why = refusal(host, addresses);
  if (why) throw why;
}

/** The lookup the connection uses: the same check, on the very addresses the socket may connect to. */
const checkedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as dns.LookupAddress[];
    const why = refusal(hostname, list.map((a) => a.address));
    if (why) return callback(why, []);
    if (options.all) callback(null, list);
    else callback(null, list[0]!.address, list[0]!.family);
  });
};

const agent = new Agent({ connect: { lookup: checkedLookup } });

/**
 * `fetch` for an address someone gave Murmur: the host is checked first, and so is every redirect.
 * Everything else about the request is the caller's.
 */
export async function safeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let current = new URL(url);
  let method = init.method ?? "GET";
  for (let hop = 0; ; hop++) {
    await assertPublicHost(current);
    let res: Response;
    try {
      const options = { ...init, method, redirect: "manual", dispatcher: agent } as Parameters<typeof undiciFetch>[1];
      res = (await undiciFetch(current, options)) as unknown as Response;
    } catch (err) {
      // A refusal from the lookup comes wrapped in "fetch failed".
      if (err instanceof Error && err.cause instanceof HttpError) throw err.cause;
      throw err;
    }
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
