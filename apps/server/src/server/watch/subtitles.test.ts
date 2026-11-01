import { describe, expect, it } from "vitest";
import {
  cueAt,
  cuesToVtt,
  decodeSubtitle,
  languageName,
  parseCues,
  pickSubtitle,
  sidecarTags,
  subtitleDetails,
  subtitleLanguage,
  subtitleName,
  subtitleRows,
  type VideoSubtitleTrack,
} from "@murmur/shared";
import { subtitleFilesFor } from "./parse";

const track = (id: string, language: string | null, more: Partial<VideoSubtitleTrack> = {}): VideoSubtitleTrack => ({
  id,
  source: "embedded",
  index: 0,
  codec: "subrip",
  language,
  title: null,
  isDefault: false,
  forced: false,
  sdh: false,
  ...more,
});

describe("reading subtitles", () => {
  it("reads an .srt with Windows line ends, tags and short milliseconds", () => {
    const cues = parseCues("1\r\n00:00:01,500 --> 00:00:03,25\r\n<i>Hello</i> {\\an8}there\r\nfriend\r\n\r\n2\r\n01:00:00,000 --> 01:00:02,000\r\nBye\r\n");
    expect(cues).toEqual([
      { start: 1.5, end: 3.25, text: "Hello there\nfriend" },
      { start: 3600, end: 3602, text: "Bye" },
    ]);
  });

  it("reads a .vtt, skipping its header and notes, with no hours and cue settings", () => {
    const cues = parseCues("WEBVTT - a title\n\nNOTE made by hand\n\nintro\n00:05.000 --> 00:06.000 line:10%\nOne &amp; two\n");
    expect(cues).toEqual([{ start: 5, end: 6, text: "One & two" }]);
  });

  it("decodes each encoding people's files come in", () => {
    expect(decodeSubtitle(new TextEncoder().encode("café"))).toBe("café");
    expect(decodeSubtitle(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
    expect(decodeSubtitle(new Uint8Array([0xff, 0xfe, 0x63, 0x00]))).toBe("c");
  });

  it("finds the line showing, including overlapping ones", () => {
    const cues = [
      { start: 1, end: 5, text: "a" },
      { start: 2, end: 3, text: "b" },
      { start: 10, end: 11, text: "c" },
    ];
    expect(cueAt(cues, 0.5)).toBe("");
    expect(cueAt(cues, 2.5)).toBe("a\nb");
    expect(cueAt(cues, 4)).toBe("a");
    expect(cueAt(cues, 7)).toBe("");
    expect(cueAt(cues, 10.5)).toBe("c");
  });

  it("writes WebVTT moved onto a stream's clock", () => {
    const cues = [
      { start: 5, end: 6, text: "gone" },
      { start: 9, end: 11, text: "cut" },
      { start: 3700, end: 3701.5, text: "a < b & c" },
    ];
    expect(cuesToVtt(cues, 10)).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\ncut\n\n01:01:30.000 --> 01:01:31.500\na &lt; b &amp; c\n");
    expect(parseCues(cuesToVtt(cues))).toEqual(cues);
  });
});

describe("naming subtitle files", () => {
  it("reads the tags Plex and release groups use", () => {
    expect(sidecarTags("en")).toMatchObject({ language: "eng", forced: false, sdh: false, title: null });
    expect(sidecarTags("eng.forced")).toMatchObject({ language: "eng", forced: true });
    expect(sidecarTags("en.hi")).toMatchObject({ language: "eng", sdh: true });
    expect(sidecarTags("hi")).toMatchObject({ language: "hin", sdh: false });
    expect(sidecarTags("en.sdh")).toMatchObject({ language: "eng", sdh: true });
    expect(sidecarTags("2_English")).toMatchObject({ language: "eng", title: null });
    expect(sidecarTags("pt-BR")).toMatchObject({ language: "por" });
    expect(sidecarTags("Commentary")).toMatchObject({ language: null, title: "Commentary" });
  });

  it("gives every language one code", () => {
    expect(["en", "eng", "English"].map(subtitleLanguage)).toEqual(["eng", "eng", "eng"]);
    expect(["fre", "fra", "fr"].map(subtitleLanguage)).toEqual(["fra", "fra", "fra"]);
    expect(subtitleLanguage("tlh")).toBe("tlh");
  });

  it("names languages without Intl, for the app", () => {
    expect(["eng", "fre", "bg", "cat"].map(languageName)).toEqual(["English", "French", "Bulgarian", "Catalan"]);
    expect(languageName("tlh")).toBeNull();
  });

  const names = new Map([
    ["Movie (2019)", ["Movie (2019).en.srt", "Movie (2019).en.forced.vtt", "Movie (2019) 4K.es.srt", "other.srt"]],
    ["Movie (2019)/Subs", ["English.srt"]],
    ["Show/Season 01", ["Show S01E01.en.srt", "Show S01E02.en.srt"]],
    ["Show/Season 01/Subs/Show S01E01", ["3_French.srt"]],
    ["Show/Season 01/Subs", ["Show S01E02.de.srt"]],
  ]);

  it("matches a file to its video by name, with Subs folders too", () => {
    const paths = (rel: string, sole: boolean) => subtitleFilesFor(rel, names, sole).map((f) => f.file);
    expect(paths("Show/Season 01/Show S01E01.mkv", false)).toEqual(["Show/Season 01/Show S01E01.en.srt", "Show/Season 01/Subs/Show S01E01/3_French.srt"]);
    expect(paths("Show/Season 01/Show S01E02.mkv", false)).toEqual(["Show/Season 01/Show S01E02.en.srt", "Show/Season 01/Subs/Show S01E02.de.srt"]);
    // "Movie (2019) 4K.es.srt" belongs to another version.
    expect(paths("Movie (2019)/Movie (2019).mkv", false)).toEqual(["Movie (2019)/Movie (2019).en.srt", "Movie (2019)/Movie (2019).en.forced.vtt"]);
  });

  it("gives a movie with one version anything in its folder", () => {
    const found = subtitleFilesFor("Movie (2019)/Movie (2019).mkv", names, true);
    expect(found.map((f) => f.file)).toEqual([
      "Movie (2019)/Movie (2019).en.srt",
      "Movie (2019)/Movie (2019).en.forced.vtt",
      "Movie (2019)/Movie (2019) 4K.es.srt",
      "Movie (2019)/other.srt",
      "Movie (2019)/Subs/English.srt",
    ]);
    expect(found[1]).toMatchObject({ language: "eng", forced: true, source: "file", codec: "webvtt" });
    expect(found[4]).toMatchObject({ language: "eng", codec: "subrip" });
  });

  it("gives each file an id that survives other files coming and going", () => {
    const a = subtitleFilesFor("Show/Season 01/Show S01E01.mkv", names, false)[0]!;
    const b = subtitleFilesFor("Show/Season 01/Show S01E01.mkv", new Map([["Show/Season 01", ["Show S01E01.en.srt"]]]), false)[0]!;
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^f/);
  });
});

describe("naming and picking tracks", () => {
  it("lists a language's plain track first", () => {
    const rows = subtitleRows([track("a", "spa"), track("b", "eng", { forced: true }), track("c", "eng", { sdh: true }), track("d", "eng")]);
    expect(rows.map((t) => t.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("leaves out titles that only repeat the row", () => {
    expect(subtitleName(track("a", "eng", { title: "English (SDH)", sdh: true }))).toBe("English");
    expect(subtitleName(track("a", "eng", { title: "Forced", forced: true }))).toBe("English");
    expect(subtitleName(track("a", "spa", { title: "Latin America" }))).toBe("Spanish, Latin America");
    expect(subtitleDetails(track("a", "eng", { sdh: true }))).toBe("SDH");
    expect(subtitleDetails(track("a", "eng", { sdh: true, forced: true }))).toBe("Forced");
  });

  const tracks = [track("full", "eng", { isDefault: true }), track("forced", "eng", { forced: true }), track("fr", "fra")];

  it("opens with what's remembered", () => {
    expect(pickSubtitle(tracks, "fra", "eng")?.id).toBe("fr");
    expect(pickSubtitle(tracks, "eng", "eng")?.id).toBe("full");
  });

  it("uses a forced track when nothing else is on, even with subtitles off", () => {
    expect(pickSubtitle(tracks, null, "eng")?.id).toBe("forced");
    expect(pickSubtitle(tracks, "off", "en")?.id).toBe("forced");
    expect(pickSubtitle(tracks, "deu", "eng")?.id).toBe("forced");
  });

  it("doesn't turn subtitles on for a file's default track alone", () => {
    expect(pickSubtitle(tracks, null, "jpn")).toBeNull();
    expect(pickSubtitle([track("full", "eng", { isDefault: true })], null, "eng")).toBeNull();
  });

  it("remembers a track with no language by its id", () => {
    expect(pickSubtitle([track("e0", null)], "e0", null)?.id).toBe("e0");
  });
});
