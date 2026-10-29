import crypto from "node:crypto";
import { expect, it } from "vitest";
import { CAST_PATH, CAST_TOKEN_MS, castPrefixAllowed, checkCastToken, signCastToken } from "./cast";

const key = crypto.randomBytes(32);
const now = 1_800_000_000_000;
const token = signCastToken(key, 7, ["/api/stream/book/b1/", "/api/books/b1/cover"], now);

it("opens only the paths a cast token names, read-only", () => {
  expect(checkCastToken(key, token, "GET", "/api/stream/book/b1/0", now)).toBe(7);
  expect(checkCastToken(key, token, "HEAD", "/api/stream/book/b1/3", now)).toBe(7);
  expect(checkCastToken(key, token, "GET", "/api/books/b1/cover", now)).toBe(7);
  expect(checkCastToken(key, token, "GET", "/api/stream/book/b2/0", now)).toBeNull();
  expect(checkCastToken(key, token, "GET", "/api/books/b1/coverage", now)).toBeNull();
  expect(checkCastToken(key, token, "POST", "/api/books/b1/cover", now)).toBeNull();
});

it("refuses a cast token that's expired, forged or from another key", () => {
  expect(checkCastToken(key, token, "GET", "/api/stream/book/b1/0", now + CAST_TOKEN_MS + 1)).toBeNull();
  const [payload, sig] = token.split(".");
  const widened = Buffer.from(JSON.stringify({ u: 1, s: ["/api/stream/book/b1/"], e: now + CAST_TOKEN_MS })).toString("base64url");
  expect(checkCastToken(key, `${widened}.${sig}`, "GET", "/api/stream/book/b1/0", now)).toBeNull();
  expect(checkCastToken(crypto.randomBytes(32), `${payload}.${sig}`, "GET", "/api/stream/book/b1/0", now)).toBeNull();
  expect(checkCastToken(key, "nonsense", "GET", "/api/stream/book/b1/0", now)).toBeNull();
});

it("never signs its way past the media routes", () => {
  expect(castPrefixAllowed("/api/watch/streams/s1/")).toBe(true);
  expect(castPrefixAllowed("/api/stream/episode/e1")).toBe(true);
  expect(castPrefixAllowed("/api/stream/episode/e1/")).toBe(false);
  expect(castPrefixAllowed("/api/watch/movies/m1/backdrop")).toBe(true);
  expect(castPrefixAllowed("/api/")).toBe(false);
  expect(castPrefixAllowed("/api/stream/")).toBe(false);
  expect(castPrefixAllowed("/api/users/")).toBe(false);
  const wide = signCastToken(key, 7, ["/api/"], now);
  expect(checkCastToken(key, wide, "GET", "/api/users", now)).toBeNull();
});

it("finds the token and the real path in a cast link", () => {
  const m = CAST_PATH.exec(`/api/cast/${token}/api/watch/streams/s1/index.m3u8`);
  expect(m?.[1]).toBe(token);
  expect(m?.[2]).toBe("/api/watch/streams/s1/index.m3u8");
});
