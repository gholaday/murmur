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
