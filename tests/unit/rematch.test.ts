import { describe, expect, it } from "vitest";

import { rematchName } from "@/lib/rematch";

describe("rematchName", () => {
  it("steps a trailing roman numeral", () => {
    expect(rematchName("The Invitational XXX")).toBe("The Invitational XXXI");
    expect(rematchName("Invitational IX")).toBe("Invitational X");
    expect(rematchName("Marathon XL")).toBe("Marathon XLI");
    expect(rematchName("Opening Night I")).toBe("Opening Night II");
    expect(rematchName("Boxing Day Classic IV")).toBe("Boxing Day Classic V");
  });

  it("steps a trailing number", () => {
    expect(rematchName("Quarterly Cup 2")).toBe("Quarterly Cup 3");
    expect(rematchName("Stag Do Round 9")).toBe("Stag Do Round 10");
    // Annual fixtures roll over to next year's running.
    expect(rematchName("Pub Golf 2026")).toBe("Pub Golf 2027");
    // Even glued on without a space.
    expect(rematchName("Invitational2")).toBe("Invitational3");
  });

  it("appends II when there is nothing to step", () => {
    expect(rematchName("Friday Swift Half")).toBe("Friday Swift Half II");
    expect(rematchName("  Friday Swift Half  ")).toBe("Friday Swift Half II");
  });

  it("leaves words that merely spell in roman letters alone", () => {
    // Not composed of numeral characters at all.
    expect(rematchName("Night at the Taxi")).toBe("Night at the Taxi II");
    // Non-canonical spelling — nothing this helper would have written.
    expect(rematchName("Pub Crawl IIII")).toBe("Pub Crawl IIII II");
    // Canonical but absurd as a sequel number (MIX reads as 1009).
    expect(rematchName("The Big MIX")).toBe("The Big MIX II");
    // Roman letters mid-name don't count — only a trailing word steps.
    expect(rematchName("XI-a-side Social")).toBe("XI-a-side Social II");
  });
});
