import { describe, expect, it } from "vitest";

import { SIGN_IN, safeNext, signInPath } from "@/lib/auth-paths";

describe("safeNext", () => {
  it("keeps a same-site path", () => {
    expect(safeNext("/rounds")).toBe("/rounds");
    expect(safeNext("/round/ABC123/results")).toBe("/round/ABC123/results");
    expect(safeNext("/courses?sort=new")).toBe("/courses?sort=new");
  });

  it("falls back to the clubhouse when there is nothing to go back to", () => {
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext("")).toBe("/");
  });

  it("refuses anything that leaves the site", () => {
    // The one that matters: a browser reads this as protocol-relative, so it
    // is an absolute URL wearing a leading slash.
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("//evil.example/round/ABC123")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("http://evil.example")).toBe("/");
    expect(safeNext("javascript:alert(1)")).toBe("/");
    expect(safeNext("rounds")).toBe("/");
  });
});

describe("signInPath", () => {
  it("stays bare when there is nowhere to come back to", () => {
    expect(signInPath()).toBe(SIGN_IN);
    expect(signInPath("/")).toBe(SIGN_IN);
    expect(signInPath(undefined)).toBe(SIGN_IN);
  });

  it("carries a real destination, encoded", () => {
    expect(signInPath("/rounds")).toBe("/signin?next=%2Frounds");
    expect(signInPath("/courses?sort=new")).toBe(
      "/signin?next=%2Fcourses%3Fsort%3Dnew",
    );
  });

  it("drops a destination that would leave the site", () => {
    expect(signInPath("//evil.example")).toBe(SIGN_IN);
    expect(signInPath("https://evil.example")).toBe(SIGN_IN);
  });
});
