import { cameThroughProxy } from "@murmur/shared";
import { describe, expect, it } from "vitest";

const check = (headers: Record<string, string>) => cameThroughProxy((name) => new Headers(headers).get(name));

describe("cameThroughProxy", () => {
  it("lets a direct call inside the stack through, with the x-forwarded-* headers Next fills in", () => {
    expect(
      check({ host: "murmur:3000", "x-forwarded-host": "murmur:3000", "x-forwarded-port": "3000", "x-forwarded-proto": "http", "x-forwarded-for": "172.18.0.3" }),
    ).toBe(false);
  });

  it("refuses what common proxies and tunnels send", () => {
    // Cloudflare Tunnel
    expect(check({ "cf-connecting-ip": "203.0.113.5", "cf-ray": "8f1a", "x-forwarded-proto": "https" })).toBe(true);
    // Caddy's defaults
    expect(check({ "x-forwarded-for": "203.0.113.5", "x-forwarded-host": "murmur.example.com", "x-forwarded-proto": "https" })).toBe(true);
    // Traefik's defaults
    expect(check({ "x-forwarded-for": "203.0.113.5", "x-forwarded-proto": "https", "x-forwarded-server": "traefik", "x-real-ip": "203.0.113.5" })).toBe(true);
    // A typical Nginx config, even over plain HTTP
    expect(check({ "x-real-ip": "192.168.1.20", "x-forwarded-for": "192.168.1.20", "x-forwarded-proto": "http" })).toBe(true);
    // Apache, and RFC 7239
    expect(check({ via: "1.1 proxy" })).toBe(true);
    expect(check({ forwarded: "for=203.0.113.5;proto=https" })).toBe(true);
  });
});
