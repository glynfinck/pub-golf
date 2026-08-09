import { describe, expect, it } from "vitest";

import { withoutSettled } from "@/lib/figures";

describe("withoutSettled", () => {
  it("dissolves a draft the server has echoed, so later edits from other phones show through", () => {
    expect(
      withoutSettled({ "1:jamie": 5, "1:priya": 3 }, { "1:jamie": 5, "1:priya": 2 }),
    ).toEqual({ "1:priya": 3 });
  });

  it("keeps a draft the server has not caught up with", () => {
    expect(withoutSettled({ "1:jamie": 5 }, { "1:jamie": 4 })).toEqual({
      "1:jamie": 5,
    });
  });

  it("keeps a draft the server has no figure for at all", () => {
    expect(withoutSettled({ "1:jamie": 5 }, {})).toEqual({ "1:jamie": 5 });
  });

  it("returns the same object when nothing settled, so a state setter can bail", () => {
    const draft = { "1:jamie": 5 };
    expect(withoutSettled(draft, { "1:jamie": 4 })).toBe(draft);
    const empty = {};
    expect(withoutSettled(empty, { "1:jamie": 4 })).toBe(empty);
  });

  it("a zero is a figure like any other — echoing 0 settles it", () => {
    expect(withoutSettled({ "1:jamie": 0 }, { "1:jamie": 0 })).toEqual({});
  });
});
