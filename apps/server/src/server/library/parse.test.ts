import { describe, expect, it } from "vitest";
import { buildBookMetadata, parseBookPath, parseTitleFolder, type ScannedAudioFile } from "./parse";

describe("parseTitleFolder", () => {
  it.each([
    ["Book 3 - The Hero of Ages", "The Hero of Ages", 3, null],
    ["03. Project Hail Mary", "Project Hail Mary", 3, null],
    ["Vol. 1.5 - Edgedancer", "Edgedancer", 1.5, null],
    ["Leviathan Wakes (Book 1)", "Leviathan Wakes", 1, null],
    ["2021 - Project Hail Mary", "Project Hail Mary", null, "2021"],
    ["Book 2 - 2007 - The Well of Ascension", "The Well of Ascension", 2, "2007"],
    ["11.22.63", "11.22.63", null, null],
    ["1984", "1984", null, null],
    ["Dune (Unabridged) [B002V1OF70]", "Dune", null, null],
    ["The Count of Monte Cristo (AmazonClassics Edition) (Unabridged)", "The Count of Monte Cristo", null, null],
  ])("%s", (folder, title, position, year) => {
    expect(parseTitleFolder(folder)).toEqual({ title, position, year });
  });
});

it("takes author and series from folders, not tags", () => {
  expect(parseBookPath("Brandon Sanderson/Mistborn/Book 2 - The Well of Ascension")).toEqual({
    author: "Brandon Sanderson",
    series: "Mistborn",
    title: "The Well of Ascension",
    position: 2,
    year: null,
  });
  expect(parseBookPath("Andy Weir/The Martian").series).toBeNull();
});

function file(name: string, durationSec: number, tags: Record<string, string> = {}, chapters: ScannedAudioFile["probe"]["chapters"] = []): ScannedAudioFile {
  return { name, relPath: `A/B/${name}`, size: 1, mtimeMs: 1, probe: { durationSec, tags, chapters, hasEmbeddedCover: false } };
}

describe("buildBookMetadata", () => {
  it("orders multi-file books naturally and lays them on one timeline", () => {
    const meta = buildBookMetadata({
      relDir: "Author/Book",
      files: [file("10.mp3", 30), file("2.mp3", 20), file("1.mp3", 10)],
    });
    expect(meta.files.map((f) => [f.relPath, f.startSec])).toEqual([
      ["A/B/1.mp3", 0],
      ["A/B/2.mp3", 10],
      ["A/B/10.mp3", 30],
    ]);
    expect(meta.durationSec).toBe(60);
    expect(meta.chapters.map((c) => [c.startSec, c.endSec])).toEqual([[0, 10], [10, 30], [30, 60]]);
  });

  it("ignores track tags when they collide and falls back to file names", () => {
    const meta = buildBookMetadata({
      relDir: "Author/Book",
      files: [file("b.mp3", 5, { track: "1" }), file("a.mp3", 5, { track: "1" })],
    });
    expect(meta.files.map((f) => f.relPath)).toEqual(["A/B/a.mp3", "A/B/b.mp3"]);
  });

  it("offsets embedded chapters by each file's start", () => {
    const meta = buildBookMetadata({
      relDir: "Author/Book",
      files: [
        file("part1.m4b", 100, { album: "Big Book" }, [{ startSec: 0, endSec: 100, title: "One" }]),
        file("part2.m4b", 50, {}, [{ startSec: 0, endSec: 20, title: "Two" }, { startSec: 20, endSec: 50, title: "Three" }]),
      ],
    });
    expect(meta.title).toBe("Big Book");
    expect(meta.chapters).toEqual([
      { title: "One", startSec: 0, endSec: 100 },
      { title: "Two", startSec: 100, endSec: 120 },
      { title: "Three", startSec: 120, endSec: 150 },
    ]);
  });
});
