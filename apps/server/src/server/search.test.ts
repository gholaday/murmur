import { byNameTier, ftsQuery, nameTier } from "@murmur/shared";
import { describe, expect, it } from "vitest";

describe("ftsQuery", () => {
  it("quotes each word so nothing is read as query syntax", () => {
    expect(ftsQuery("  dune  messiah ")).toBe('"dune" "messiah"');
    expect(ftsQuery('say "hi" NOT OR')).toBe('"say" """hi""" "NOT"');
  });

  it("drops words too short for trigram, and gives up when none are long enough", () => {
    expect(ftsQuery("of mice and men")).toBe('"mice" "and" "men"');
    expect(ftsQuery("it")).toBeNull();
    expect(ftsQuery("   ")).toBeNull();
  });

  it("counts characters, not UTF-16 units", () => {
    expect(ftsQuery("é😀")).toBeNull();
  });
});

describe("nameTier", () => {
  it("ranks the whole name, then its start, then a word's start, then anywhere, then elsewhere", () => {
    expect(nameTier("Dune", "dune")).toBe(0);
    expect(nameTier("Dune Messiah", "dune")).toBe(1);
    expect(nameTier("Children of Dune", "dune")).toBe(2);
    expect(nameTier("Sandunes", "dune")).toBe(3);
    expect(nameTier("Arrakis", "dune")).toBe(4);
  });

  it("ignores case, accents and punctuation", () => {
    expect(nameTier("Les Misérables", "MISERABLES")).toBe(2);
    expect(nameTier("AC/DC", "ac dc")).toBe(0);
  });
});

describe("byNameTier", () => {
  it("sorts by tier and keeps the given order within one", () => {
    const hits = ["Arrakis", "Children of Dune", "Dune Messiah", "Dune", "God Emperor of Dune"];
    expect(byNameTier(hits, (h) => h, "dune")).toEqual(["Dune", "Dune Messiah", "Children of Dune", "God Emperor of Dune", "Arrakis"]);
  });
});
