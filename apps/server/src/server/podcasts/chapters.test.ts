import { expect, it } from "vitest";
import { id3TagLength, parseClock, parseId3Chapters, parseJsonChapters, parsePscChapters, toChapterDtos } from "./chapters";

it("reads chapter start times in every format feeds use", () => {
  expect(parseClock("01:02:03.500")).toBe(3723.5);
  expect(parseClock("62:03")).toBe(3723);
  expect(parseClock("0")).toBe(0);
  expect(parseClock("1:x")).toBeNull();
  expect(parseClock("")).toBeNull();
});

it("reads Podlove chapters, skipping ones without a start", () => {
  expect(
    parsePscChapters([
      { "@_start": "00:00:00", "@_title": " Intro " },
      { "@_title": "No start" },
      { "@_start": "00:05:30.5", "@_title": "Main" },
    ]),
  ).toEqual([
    { startSec: 0, title: "Intro" },
    { startSec: 330.5, title: "Main" },
  ]);
  expect(parsePscChapters({ "@_start": "10", "@_title": "Only" })).toEqual([{ startSec: 10, title: "Only" }]);
});

it("reads a JSON chapters file, leaving out artwork-only entries", () => {
  expect(
    parseJsonChapters({
      version: "1.2.0",
      chapters: [
        { startTime: 0, title: "Intro" },
        { startTime: 60, title: "Picture", toc: false },
        { startTime: "120", title: "Talk", endTime: 300 },
        { title: "Broken" },
      ],
    }),
  ).toEqual([
    { startSec: 0, title: "Intro" },
    { startSec: 120, title: "Talk", endSec: 300 },
  ]);
  expect(parseJsonChapters({ chapters: [{ startTime: 50, title: "Backwards", endTime: 5 }] })).toEqual([{ startSec: 50, title: "Backwards" }]);
  expect(parseJsonChapters(null)).toEqual([]);
});

const synchsafe = (n: number) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
const size = (n: number, version: number) => {
  if (version === 4) return synchsafe(n);
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const frame = (id: string, body: Buffer, version: number) => Buffer.concat([Buffer.from(id, "latin1"), size(body.length, version), Buffer.alloc(2), body]);
const chap = (id: string, startMs: number, endMs: number, title: Buffer, version: number) => {
  const times = Buffer.alloc(16, 0xff);
  times.writeUInt32BE(startMs, 0);
  times.writeUInt32BE(endMs, 4);
  return frame("CHAP", Buffer.concat([Buffer.from(`${id}\0`, "latin1"), times, frame("TIT2", title, version)]), version);
};
const tag = (frames: Buffer[], version: number) => {
  const body = Buffer.concat([...frames, Buffer.alloc(32)]); // padding after the frames
  return Buffer.concat([Buffer.from([0x49, 0x44, 0x33, version, 0, 0]), synchsafe(body.length), body]);
};

it("reads ID3v2.4 CHAP frames with UTF-8 titles", () => {
  const buf = tag(
    [
      frame("TIT2", Buffer.from("\x03Episode", "latin1"), 4),
      chap("ch0", 0, 90_000, Buffer.concat([Buffer.from([3]), Buffer.from("Café talk\0", "utf8")]), 4),
      chap("ch1", 90_000, 0xffffffff, Buffer.concat([Buffer.from([3]), Buffer.from("News", "utf8")]), 4),
    ],
    4,
  );
  expect(id3TagLength(buf)).toBe(buf.length);
  expect(parseId3Chapters(buf)).toEqual([
    { startSec: 0, title: "Café talk", endSec: 90 },
    { startSec: 90, title: "News" },
  ]);
});

it("reads ID3v2.3 CHAP frames with UTF-16 titles", () => {
  const utf16 = (s: string) => Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(s, "utf16le")]);
  const buf = tag([chap("a", 1500, 0, utf16("One"), 3), chap("b", 61_000, 0, utf16("Two"), 3)], 3);
  expect(parseId3Chapters(buf)).toEqual([
    { startSec: 1.5, title: "One" },
    { startSec: 61, title: "Two" },
  ]);
  expect(parseId3Chapters(Buffer.from("not a tag at all"))).toEqual([]);
});

it("orders chapters, drops near-duplicates and ends each where the next starts", () => {
  expect(
    toChapterDtos(
      [
        { startSec: 600, title: "" },
        { startSec: 0, title: "Intro" },
        { startSec: 0.4, title: "Dupe" },
        { startSec: 5000, title: "Past the end" },
      ],
      1200,
    ),
  ).toEqual([
    { index: 0, title: "Intro", startSec: 0, endSec: 600 },
    { index: 1, title: "Chapter 2", startSec: 600, endSec: 1200 },
  ]);
  expect(toChapterDtos([{ startSec: 0, title: "Only one" }], 1200)).toEqual([]);
  // Without a length yet, the last chapter keeps its own end.
  expect(toChapterDtos([{ startSec: 0, title: "A" }, { startSec: 60, title: "B", endSec: 90 }], null)[1]!.endSec).toBe(90);
});
