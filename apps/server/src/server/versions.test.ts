import { describe, expect, it } from "vitest";
import { addonVersionProblem, majorOf, outOfDate } from "@murmur/shared";

describe("version checks", () => {
  it("reads the major, and leaves development builds out", () => {
    expect(majorOf("1.2.3")).toBe(1);
    expect(majorOf("v12.0.0")).toBe(12);
    expect(majorOf("dev")).toBeNull();
    expect(majorOf(null)).toBeNull();
  });

  it("says which side to update only when the majors differ", () => {
    expect(outOfDate("1.0.0", "1.9.2")).toBeNull();
    expect(outOfDate("1.9.0", "2.0.0")).toBe("app");
    expect(outOfDate("2.0.0", "1.9.0")).toBe("server");
    expect(outOfDate("1.0.0", "dev")).toBeNull();
  });

  it("names the add-on that's behind", () => {
    expect(addonVersionProblem("video", "1.4.0", "1.0.0")).toBeNull();
    expect(addonVersionProblem("video", "1.4.0", "2.0.0")).toContain("Update the add-on");
    expect(addonVersionProblem("video", "2.0.0", "1.4.0")).toContain("Update Murmur");
    expect(addonVersionProblem("video", "dev", "2.0.0")).toBeNull();
  });
});
