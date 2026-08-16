import { describe, expect, it } from "vitest";

import {
  highlight,
  highlights,
  HIGHLIGHT_MAX,
} from "@/lib/caddy/thinking";

/**
 * A thought you can read is a finished one, held still.
 *
 * The screen showed the raw tail of the model's reasoning clamped to two
 * lines, re-rendered on every token — so the text slid upward continuously and
 * was cut mid-word at both ends. It is unreadable by construction: the eye
 * cannot finish a line that is moving. These hold the rule that replaced it —
 * one complete sentence at a time, and nothing until the first one closes.
 */

describe("the caddy's last finished thought", () => {
  it("waits for a sentence to close", () => {
    // The whole point. A half-written line will change under the reader, so it
    // is not offered at all.
    expect(highlight("Looking at the pubs near")).toBeNull();
    expect(highlight("Looking at the pubs near London Bridge.")).toBe(
      "Looking at the pubs near London Bridge.",
    );
  });

  it("takes the last complete one, not the first", () => {
    const raw =
      "Nine pubs is a lot for this patch. The Anchor and the George are close. Now I need";
    expect(highlight(raw)).toBe("The Anchor and the George are close.");
  });

  it("holds still while the next one is being written", () => {
    // The line must not change token by token — that is the behaviour being
    // replaced. Every prefix of an unfinished sentence gives the same answer.
    const settled = "The Anchor is the obvious first hole.";
    for (const tail of ["", " Now", " Now I", " Now I will look"]) {
      expect(`${tail}: ${highlight(settled + tail)}`).toBe(`${tail}: ${settled}`);
    }
  });

  it("counts a question, an exclamation and an em dash as endings", () => {
    expect(highlight("Is nine too many? Probably not")).toBe(
      "Is nine too many?",
    );
    expect(highlight("That works! And then")).toBe("That works!");
    expect(highlight("Nine holes — the last one wants a hazard")).toBe(
      "Nine holes —",
    );
  });

  it("says nothing at all for nothing at all", () => {
    for (const empty of ["", "   ", "\n\n"]) {
      expect(highlight(empty)).toBeNull();
    }
  });

  it("ignores a fragment too short to be worth a row", () => {
    expect(highlight("Ok. ")).toBeNull();
    expect(highlight("Yes. No. ")).toBeNull();
  });
});

describe("what it strips", () => {
  it("renders the model's markdown as words, not as syntax", () => {
    // `**Step 3:**` on the glass reads as a bug, and reasoning arrives full of
    // it — headers, bold runs, numbered steps.
    expect(highlight("**Step 3:** pick the last hole.")).toBe(
      "Step 3: pick the last hole.",
    );
    expect(highlight("## Choosing\n- the George is close.")).toBe(
      "Choosing the George is close.",
    );
    expect(highlight("1. The Anchor works.")).toBe("The Anchor works.");
  });

  it("drops a code fence rather than printing it", () => {
    expect(highlight("```json\n{\"a\":1}\n```\nThe Anchor works.")).toBe(
      "The Anchor works.",
    );
  });

  it("collapses the newlines a stream arrives in", () => {
    expect(highlight("The Anchor\n\n   works well.")).toBe(
      "The Anchor works well.",
    );
  });
});

describe("keeping it to a headline", () => {
  it("never exceeds the ceiling", () => {
    const long = `${"a lovely old boozer ".repeat(20)}.`;
    const line = highlight(long);
    expect(line).not.toBeNull();
    expect(line!.length).toBeLessThanOrEqual(HIGHLIGHT_MAX + 1);
  });

  it("cuts at a word and says that it cut", () => {
    const source =
      "The Anchor and the George and the Ship and the Rose and the Crown and the Bell are all within a short walk.";
    const line = highlight(source);
    expect(line!.endsWith("…")).toBe(true);
    // Cut *at* a word, not through one: what is left is a whole-word prefix of
    // the thought, so the next character in the source is a space.
    const kept = line!.slice(0, -1);
    expect(source.startsWith(kept)).toBe(true);
    expect(source[kept.length]).toBe(" ");
  });

  it("leaves a short thought exactly as it was", () => {
    expect(highlight("The Anchor works.")).toBe("The Anchor works.");
  });
});

describe("the whole trail", () => {
  it("gives every finished thought, oldest first", () => {
    expect(
      highlights("Nine is a lot. The Anchor is close. Still writing"),
    ).toEqual(["Nine is a lot.", "The Anchor is close."]);
  });

  it("agrees with the single one about which is last", () => {
    const raw = "Nine is a lot. The Anchor is close. Still writing this";
    const trail = highlights(raw);
    expect(trail.at(-1)).toBe(highlight(raw));
  });

  it("is empty until something closes", () => {
    expect(highlights("Looking at the pubs near")).toEqual([]);
  });
});
