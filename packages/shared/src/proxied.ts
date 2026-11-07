// The add-ons only ever talk to Murmur, and Murmur to the video add-on, directly inside the Docker
// stack. A request that passed through a reverse proxy or tunnel (Cloudflare, Caddy, Nginx,
// Traefik, Tailscale...) came from outside, so add-on endpoints refuse it whatever it carries.
// This is an extra layer: the real guard is that the add-ons have no ports and the secret.

/** Headers proxies and CDNs add that a direct call inside the stack never has, and Next never makes up. */
const PROXY_HEADERS = ["forwarded", "via", "x-real-ip", "true-client-ip", "x-forwarded-server", "cdn-loop", "cf-connecting-ip", "cf-ray"];

/**
 * Whether a request came through a proxy. Calls inside the stack are plain HTTP, so
 * `x-forwarded-proto: https` means a proxy took the TLS, which every remote-access setup does.
 */
export function cameThroughProxy(header: (name: string) => string | null | undefined): boolean {
  return PROXY_HEADERS.some((name) => !!header(name)) || header("x-forwarded-proto") === "https";
}

/**
 * The shortest ADDON_SECRET Murmur and the add-ons accept: anyone who guesses it can use an
 * add-on as Murmur would. `openssl rand -hex 32` gives 64 characters.
 */
export const ADDON_SECRET_MIN_LENGTH = 32;

/** The Authorization header every call between Murmur and an add-on carries. */
export const addonAuthorization = (secret: string) => `Bearer ${secret}`;

/** Whether an Authorization header carries the secret. Takes the same time however much of it matches. */
export function addonSecretMatches(header: string | null | undefined, secret: string): boolean {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!secret || token.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= token.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

/** Why an ADDON_SECRET can't be used, or null when it's long enough (or not set at all). */
export function addonSecretProblem(secret: string): string | null {
  return secret && secret.length < ADDON_SECRET_MIN_LENGTH
    ? `ADDON_SECRET is too short. Use at least ${ADDON_SECRET_MIN_LENGTH} characters, for example the output of openssl rand -hex 32, on Murmur and the add-ons.`
    : null;
}
