import { describe, expect, it } from "vitest";

import {
  countWord,
  ordinal,
  toParClass,
  underOverPhrase,
} from "@/lib/format";
import { formatToPar } from "@/lib/utils";

describe("formatToPar", () => {
  it("says 'even', never golf's lone E", () => {
    expect(formatToPar(0)).toBe("even");
  });

  it("signs a number over par", () => {
    expect(formatToPar(3)).toBe("+3");
  });

  it("renders under par with a typographic minus, not a hyphen", () => {
    // U+2212 MINUS SIGN. A hyphen here is the kind of thing a well-meaning
    // refactor "fixes", so assert the code point outright.
    expect(formatToPar(-2)).toBe("−2");
    expect(formatToPar(-2).codePointAt(0)).toBe(0x2212);
    expect(formatToPar(-2)).not.toContain("-");
  });
});

describe("countWord", () => {
  it("spells out magnitudes up to ten", () => {
    expect(countWord(1)).toBe("one");
    expect(countWord(10)).toBe("ten");
  });

  it("switches to digits past ten", () => {
    expect(countWord(11)).toBe("11");
    expect(countWord(42)).toBe("42");
  });

  it("speaks in magnitudes, so a negative reads as its size", () => {
    expect(countWord(-3)).toBe("three");
    expect(countWord(-14)).toBe("14");
  });

  it("has no word for zero", () => {
    // Callers must guard this — underOverPhrase does, with its "level" branch.
    expect(countWord(0)).toBe("");
  });
});

describe("underOverPhrase", () => {
  it("calls nothing at all 'level'", () => {
    expect(underOverPhrase(0)).toBe("level");
  });

  it("reads under and over par in words", () => {
    expect(underOverPhrase(-2)).toBe("two under");
    expect(underOverPhrase(3)).toBe("three over");
  });

  it("falls back to digits past ten", () => {
    expect(underOverPhrase(-11)).toBe("11 under");
  });
});

describe("toParClass", () => {
  it("colours under par good, level muted, over par hazard", () => {
    expect(toParClass(-1)).toBe("text-good");
    expect(toParClass(0)).toBe("text-muted-foreground");
    expect(toParClass(1)).toBe("text-hazard");
  });
});

describe("ordinal", () => {
  it("suffixes the ones digit", () => {
    expect([1, 2, 3, 4].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th"]);
  });

  it("makes the teens an exception", () => {
    expect([11, 12, 13].map(ordinal)).toEqual(["11th", "12th", "13th"]);
  });

  it("resumes the pattern in the twenties", () => {
    expect([21, 22, 23].map(ordinal)).toEqual(["21st", "22nd", "23rd"]);
  });

  it("applies the teens exception per hundred, not per number", () => {
    expect(ordinal(101)).toBe("101st");
    expect([111, 112, 113].map(ordinal)).toEqual(["111th", "112th", "113th"]);
  });

  it("has a suffix for zero", () => {
    expect(ordinal(0)).toBe("0th");
  });
});
