import { describe, expect, it } from "vitest";

import {
  highlight,
  highlights,
  holdThought,
  HIGHLIGHT_MAX,
  HOLD_MS,
  NOTHING_HELD,
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
      expect(`${tail}: ${highlight(settled + tail)}`).toBe(
        `${tail}: ${settled}`,
      );
    }
  });

  it("counts a question, an exclamation and an em dash as endings", () => {
    expect(highlight("Is nine too many? Probably not")).toBe(
      "Is nine too many?",
    );
    expect(highlight("That one works well! And then")).toBe(
      "That one works well!",
    );
    // The dash ends the clause and does not count towards its three words —
    // hence a fixture with three real ones in front of it.
    expect(
      highlight("Nine holes is plenty — the last one wants a hazard"),
    ).toBe("Nine holes is plenty —");
  });

  it("says nothing at all for nothing at all", () => {
    for (const empty of ["", "   ", "\n\n"]) {
      expect(highlight(empty)).toBeNull();
    }
  });

  it("ignores a fragment too short to be worth a row", () => {
    // Reasoning is full of one- and two-word acknowledgements. They were
    // harmless while each line was replaced the moment the next closed; now
    // that a thought is *held* to be read, a filler takes the row for two
    // seconds and makes the real sentence behind it wait.
    expect(highlight("Ok. ")).toBeNull();
    expect(highlight("Yes. No. ")).toBeNull();
    // A stream ending on one answers null rather than reaching back for the
    // last real sentence. Keeping that one on screen is the holder's job, and
    // is asserted there.
    for (const filler of ["Good.", "Close enough.", "That works!", "Right —"]) {
      expect(
        // The unfinished tail is how these actually arrive, and it is also
        // what closes an em dash — `plain` trims, so a dash at the very end of
        // a stream is a clause still being written, not an ending.
        `${filler}: ${highlight(`The Anchor opens at four. ${filler} and then`)}`,
      ).toBe(`${filler}: null`);
    }
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
    expect(highlight('```json\n{"a":1}\n```\nThe Anchor works.')).toBe(
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

/**
 * A finished thought still has to stay put long enough to be read.
 *
 * `highlight` fixed the mid-word cutting and nothing else: it hands back a new
 * line the instant a sentence closes, and dressing nine holes the caddy closes
 * short sentences in bursts. Three swaps in a second is the same
 * unreadability at a slower rate — each line legible on its own, none of them
 * on screen long enough to finish. These hold the pacing that fixed it.
 */
describe("holding a thought", () => {
  const AT = 10_000;
  const ONE = "The Anchor is the obvious opener.";
  const TWO = "The George has cask, so the second drink can be a half.";

  it("puts the first one up straight away", () => {
    // There is nothing on screen for it to interrupt, so a hold here would be
    // a blank row with a timer on it.
    const { held, waitMs } = holdThought(NOTHING_HELD, ONE, AT);
    expect(held).toEqual({ line: ONE, since: AT });
    expect(waitMs).toBeNull();
  });

  it("hands the same object back when nothing should change", () => {
    // Identity, not equality — this is the render that never happens.
    const held = { line: ONE, since: AT };
    expect(holdThought(held, ONE, AT + 5_000).held).toBe(held);
  });

  it("holds a newer thought until the current one has been read", () => {
    const held = { line: ONE, since: AT };
    const early = holdThought(held, `${ONE} ${TWO}`, AT + 500, 2_000);
    expect(early.held).toBe(held);
    expect(early.waitMs).toBe(1_500);

    const late = holdThought(held, `${ONE} ${TWO}`, AT + 2_000, 2_000);
    expect(late.held).toEqual({ line: TWO, since: AT + 2_000 });
    expect(late.waitMs).toBeNull();
  });

  it("reads a burst as its last word", () => {
    // Four closes inside one hold. The reader gets the newest when the hold is
    // up — queueing the ones they never saw would only move the flicker later.
    const held = { line: ONE, since: AT };
    const burst = `${ONE} A. B. C. ${TWO}`;
    expect(holdThought(held, burst, AT + 400, 2_000).held).toBe(held);
    expect(holdThought(held, burst, AT + 2_100, 2_000).held.line).toBe(TWO);
  });

  it("does not let a filler take the row from a real thought", () => {
    // The reason the floor moved: while every close replaced the last line
    // immediately, "Good." was on screen for an instant. Held for two seconds
    // it takes the row *and* makes the real sentence behind it wait out the
    // hold — so the one moment a reader looks up, the caddy is saying "Good."
    const held = { line: ONE, since: AT };
    const raw = `${ONE} Good. Fine. ${TWO}`;
    expect(holdThought(held, `${ONE} Good. Fine.`, AT + 9_000).held).toBe(held);
    expect(holdThought(held, raw, AT + 9_000).held.line).toBe(TWO);
  });

  it("never blanks a thought the stream has stopped adding to", () => {
    // A run that ends mid-sentence leaves `highlight` with nothing new to say.
    // Clearing the row on that reads as the caddy having given up.
    const held = { line: ONE, since: AT };
    expect(holdThought(held, `${ONE} still writing`, AT + 9_000).held).toBe(
      held,
    );
    expect(holdThought(held, "", AT + 9_000).held).toBe(held);
  });

  it("asks to be called back exactly once per waiting thought", () => {
    // `waitMs` is what stops the caller polling: null means there is nothing
    // to come back for.
    expect(holdThought(NOTHING_HELD, "", AT).waitMs).toBeNull();
    expect(
      holdThought({ line: ONE, since: AT }, ONE, AT + 10).waitMs,
    ).toBeNull();
  });

  it("gives a line long enough to read and no longer", () => {
    // The hold has to cover the reading time of the longest line that can be
    // put up, or the pacing is a promise it does not keep. About 12
    // characters a second is a comfortable glance.
    expect(HOLD_MS).toBeGreaterThanOrEqual((HIGHLIGHT_MAX / 12) * 300);
  });
});
