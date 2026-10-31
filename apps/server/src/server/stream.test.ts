import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { parseRange } from "@murmur/shared";
import { resolveInside } from "./stream";

it("serves files inside a library folder, through links that stay inside, and nothing a link takes outside", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-inside-"));
  try {
    const library = path.join(tmp, "library");
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(path.join(library, "Author", "Book"), { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(library, "Author", "Book", "a.m4b"), "x");
    fs.writeFileSync(path.join(outside, "secret.txt"), "x");
    // Junctions need no admin rights on Windows; elsewhere they're plain directory links.
    fs.symlinkSync(path.join(library, "Author"), path.join(library, "Alias"), "junction");
    fs.symlinkSync(outside, path.join(library, "Escape"), "junction");

    expect(resolveInside(library, "Author/Book/a.m4b")).toBe(fs.realpathSync.native(path.join(library, "Author", "Book", "a.m4b")));
    expect(resolveInside(library, "Alias/Book/a.m4b")).toBe(fs.realpathSync.native(path.join(library, "Author", "Book", "a.m4b")));
    expect(() => resolveInside(library, "Escape/secret.txt")).toThrow("outside the library folder");
    expect(() => resolveInside(library, "../outside/secret.txt")).toThrow("Invalid file path");
    expect(() => resolveInside(library, "Author/missing.m4b")).toThrow("missing");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

it("parses the byte ranges audio players send", () => {
  expect(parseRange(null, 1000)).toBeNull();
  expect(parseRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
  expect(parseRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
  expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
  expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
  expect(parseRange("bytes=0-1,5-6", 1000)).toBeNull(); // multi-range: serve the whole file
});
