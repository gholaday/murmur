import { describe, expect, it } from "vitest";
import { pickMatch, tmdbIdFromName, type TmdbResult } from "./match-score";

const r = (id: number, title: string, year: number | null, originalTitle = title): TmdbResult => ({ id, title, originalTitle, year });

describe("tmdbIdFromName", () => {
  it("reads Plex and Jellyfin tags", () => {
    expect(tmdbIdFromName("The Matrix (1999) {tmdb-603}")).toBe(603);
    expect(tmdbIdFromName("The Matrix (1999) [tmdbid-603]")).toBe(603);
    expect(tmdbIdFromName("The Matrix (1999)")).toBeNull();
  });
});

describe("pickMatch", () => {
  it("takes a close title in the same year, or a year off", () => {
    expect(pickMatch({ title: "Ben-Hur", year: 1959 }, [r(665, "Ben-Hur", 1959)])?.id).toBe(665);
    expect(pickMatch({ title: "Oppenheimer", year: 2022 }, [r(872585, "Oppenheimer", 2023)])?.id).toBe(872585);
  });

  it("matches a long folder name that holds TMDB's title", () => {
    const empire = r(1891, "The Empire Strikes Back", 1980);
    expect(pickMatch({ title: "Star Wars Episode V - The Empire Strikes Back", year: 1980 }, [empire])?.id).toBe(1891);
  });

  it("skips a remake from another year", () => {
    expect(pickMatch({ title: "Ben-Hur", year: 1959 }, [r(271969, "Ben-Hur", 2016), r(665, "Ben-Hur", 1959)])?.id).toBe(665);
    expect(pickMatch({ title: "Ben-Hur", year: 1959 }, [r(271969, "Ben-Hur", 2016)])).toBeNull();
  });

  it("needs an exact title without a year", () => {
    expect(pickMatch({ title: "The Nice Guys", year: null }, [r(290250, "The Nice Guys", 2016)])?.id).toBe(290250);
    expect(pickMatch({ title: "Nice", year: null }, [r(290250, "The Nice Guys", 2016)])).toBeNull();
  });
});
