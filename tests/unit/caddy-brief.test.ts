import { describe, expect, it } from "vitest";

import { readBrief, stretchWarning } from "@/lib/caddy/brief";


describe("a night that goes somewhere", () => {
  it("carries a second area", () => {
    const brief = readBrief({
      where: "Finsbury Park",
      whereTo: "Broadway Market",
      holes: 9,
      vibe: "traditional",
      particulars: [],
      note: "",
      stretch: 8,
    });
    expect(brief?.where).toBe("Finsbury Park");
    expect(brief?.whereTo).toBe("Broadway Market");
  });

  it("treats the same area twice as one patch", () => {
    // A host who picks their own area for both ends wants a tight round, not a
    // walk back to where they began. Case-insensitively, because the two
    // fields are typed separately.
    const brief = readBrief({
      where: "Shoreditch",
      whereTo: "shoreditch",
      holes: 9,
      vibe: "traditional",
      particulars: [],
      note: "",
      stretch: 8,
    });
    expect(brief?.whereTo).toBe("");
  });

  it("defaults to one patch when no destination is given", () => {
    const brief = readBrief({ where: "Soho", holes: 9, vibe: "traditional", particulars: [], note: "", stretch: 8 });
    expect(brief?.whereTo).toBe("");
  });
});

describe("stretchWarning", () => {
  it("warns before the fee is spent when the walk is a march", () => {
    // Finsbury Park to Broadway Market is about 4km. Over nine holes that is
    // half a kilometre a leg, which is a walk but a fair one.
    expect(stretchWarning(4, 9)).toBeNull();
    // The same two ends over four holes is well over a kilometre each, which
    // is a march between drinks and worth saying out loud.
    const warned = stretchWarning(4, 4);
    expect(warned).toMatch(/proper walk/);
    expect(warned).toContain("4.0km");
  });

  it("says when two areas are really one", () => {
    const warned = stretchWarning(0.4, 9);
    expect(warned).toMatch(/one patch/);
  });

  it("says nothing about an ordinary round", () => {
    // Most rounds. A warning on every plan is a warning nobody reads.
    expect(stretchWarning(2.5, 9)).toBeNull();
    expect(stretchWarning(0, 9)).toBeNull();
  });

  it("never divides by zero on a one-hole round", () => {
    expect(() => stretchWarning(3, 1)).not.toThrow();
  });
});
