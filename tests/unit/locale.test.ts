import { describe, expect, it } from "vitest";

import { primaryLanguage } from "@/lib/locale";

describe("primaryLanguage", () => {
  it("takes the first tag from an ordinary browser header", () => {
    expect(primaryLanguage("en-GB,en;q=0.9,en-US;q=0.8")).toBe("en-GB");
  });

  it("respects q-values over header order", () => {
    expect(primaryLanguage("fr;q=0.8,de;q=0.9")).toBe("de");
  });

  it("keeps header order between equal weights", () => {
    expect(primaryLanguage("pt-BR,es")).toBe("pt-BR");
  });

  it("passes region and script subtags through untouched", () => {
    expect(primaryLanguage("zh-Hant-TW")).toBe("zh-Hant-TW");
  });

  it("skips the wildcard", () => {
    expect(primaryLanguage("*")).toBeNull();
    expect(primaryLanguage("*,ja;q=0.5")).toBe("ja");
  });

  it("skips a tag explicitly weighted to zero", () => {
    expect(primaryLanguage("en;q=0,cy")).toBe("cy");
  });

  it("has nothing for a missing or malformed header", () => {
    expect(primaryLanguage(null)).toBeNull();
    expect(primaryLanguage("")).toBeNull();
    expect(primaryLanguage("!!;q=nonsense")).toBeNull();
  });
});
