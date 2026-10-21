import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { createLogger } from "../log";
import { walkFolder } from "./scanner";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-walk-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function file(rel: string, content = "x") {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}

it("finds every folder holding audio, with disc folders joined to their book", async () => {
  file("Andy Weir/Project Hail Mary/Project Hail Mary.m4b");
  file("Andy Weir/Project Hail Mary/cover.jpg");
  file("Andy Weir/Project Hail Mary/desc.txt", "A teacher wakes up in space.");
  file("Andy Weir/Project Hail Mary/reader.txt", "Ray Porter");
  file("Brandon Sanderson/Mistborn/Book 1 - The Final Empire/01.mp3");
  file("Brandon Sanderson/Mistborn/Book 1 - The Final Empire/02.mp3");
  file("Tolkien/The Hobbit/CD 1/01.mp3");
  file("Tolkien/The Hobbit/CD 2/01.mp3");
  file("Tolkien/The Hobbit/notes.pdf");
  file("Empty Author/No Audio/cover.jpg");
  file("loose.mp3"); // straight in the library folder: not a book

  const found = await walkFolder({ id: 1, path: root } as Parameters<typeof walkFolder>[0], createLogger("test"));
  const byDir = new Map(found.map((b) => [b.relDir, b]));

  expect([...byDir.keys()].sort()).toEqual([
    "Andy Weir/Project Hail Mary",
    "Brandon Sanderson/Mistborn/Book 1 - The Final Empire",
    "Tolkien/The Hobbit",
  ]);
  const phm = byDir.get("Andy Weir/Project Hail Mary")!;
  expect(phm.audio.map((f) => f.name)).toEqual(["Project Hail Mary.m4b"]);
  expect(phm.images.map((f) => f.name)).toEqual(["cover.jpg"]);
  expect(phm.descTxt?.name).toBe("desc.txt");
  expect(phm.readerTxt?.name).toBe("reader.txt");
  expect(byDir.get("Tolkien/The Hobbit")!.audio.map((f) => f.relPath).sort()).toEqual([
    "Tolkien/The Hobbit/CD 1/01.mp3",
    "Tolkien/The Hobbit/CD 2/01.mp3",
  ]);
});

it("gives a book the same signature until one of its files changes", async () => {
  file("Sig/Book/01.mp3");
  const walk = async () => (await walkFolder({ id: 1, path: root } as Parameters<typeof walkFolder>[0], createLogger("test"))).find((b) => b.relDir === "Sig/Book")!;
  const before = await walk();
  expect((await walk()).signature).toBe(before.signature);
  file("Sig/Book/01.mp3", "longer audio");
  const after = await walk();
  expect(after.signature).not.toBe(before.signature);
  expect(after.contentKey).not.toBe(before.contentKey); // the size changed too
});
