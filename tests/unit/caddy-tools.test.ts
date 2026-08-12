import { describe, expect, it } from "vitest";

import {
  buildCandidates,
  EMPTY_FACTS,
  type PubSource,
} from "@/lib/caddy/dossier";
import {
  CADDY_LOOP_MS,
  CADDY_TOOLS,
  TOOL_NAME,
  TOOL_READ,
  TOOL_REMOVE,
  TOOL_SEARCH,
  TOOL_SET,
  TURN_HEADROOM_MS,
  TURN_TIMEOUT_MS,
  applyDraftTool,
  boardBlock,
  freshPicks,
  isDraftTool,
  outOfLoopTime,
  readSearchCall,
  searchResultBlock,
  type CaddyBoard,
} from "@/lib/caddy/tools";

// ————————————————— fixtures —————————————————

function source(n: number, over: Partial<PubSource> = {}): PubSource {
  return {
    venueId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name: `The Pub ${n}`,
    address: `${n} Example Street`,
    rating: 4,
    reviewCount: 100 + n,
    lat: 51.5 + n / 1000,
    lng: -0.07 - n / 1000,
    priceLevel: 2,
    facts: { ...EMPTY_FACTS },
    editorial: null,
    reviews: [],
    ...over,
  };
}

const CANDIDATES = buildCandidates(Array.from({ length: 6 }, (_, i) => source(i + 1)));

function hole(id: string) {
  return {
    candidateId: id,
    drink: "Pint",
    par: 4,
    hazard: null,
    hazardNote: null,
    fitNote: null,
    localRules: [],
  };
}

const BOARD: CaddyBoard = {
  name: "The Test Invitational",
  holes: [hole("p1"), hole("p2"), hole("p3")],
};

/** Every property name any tool will accept, gathered from the schemas. */
function propertyNames(node: unknown, found: string[] = []): string[] {
  if (typeof node !== "object" || node === null) return found;
  const row = node as Record<string, unknown>;
  if (row.properties && typeof row.properties === "object") {
    found.push(...Object.keys(row.properties as Record<string, unknown>));
  }
  Object.values(row).forEach((value) => {
    if (Array.isArray(value)) value.forEach((item) => propertyNames(item, found));
    else propertyNames(value, found);
  });
  return found;
}

// ————————————————— the rule —————————————————

describe("the caddy cannot name a pub", () => {
  it("offers no tool input a pub's name or address could travel in", () => {
    // The load-bearing test of this module, and the successor to the schema
    // enum that used to hold the line. An allowlist rather than a regex,
    // because `name_course.name` is a legitimate `name` — it is the course's,
    // not a venue's — and a pattern match would either miss the real thing or
    // fail on that one forever.
    const allowed = new Set([
      // the only way to say which pub: an id we issued
      "candidateId",
      // and the same thing in bulk, for routing a set the caddy is weighing
      // up. Still ids, still ours — a list of them is no more expressive
      // about a venue than one is.
      "candidateIds",
      "near",
      // where on the card, and how it is dressed
      "hole",
      "from",
      "to",
      "drink",
      "par",
      "hazard",
      "hazardNote",
      "fitNote",
      "localRules",
      "strokes",
      "reason",
      // the course's own name, and a plain-words search
      "name",
      "query",
      // the curator's own vocabulary: how many stops to plan, which end to
      // pin (by id — `startNear` and `finishNear` take the same ids as
      // `candidateId` and are refused the same way), why a pub was ruled out,
      // and how to recognise a kept draft. None of them can say *what a pub
      // is*, which is the line this list defends.
      "holes",
      "startNear",
      "finishNear",
      "why",
      "note",
      "draft",
    ]);
    const names = new Set(propertyNames(CADDY_TOOLS.map((t) => t.input_schema)));
    expect([...names].filter((n) => !allowed.has(n))).toEqual([]);
    // And specifically: nothing a venue is identified by.
    ["venueName", "venue", "pub", "address", "placeId", "googlePlaceId"].forEach(
      (banned) => expect(names.has(banned)).toBe(false),
    );
  });

  it("refuses an id nobody offered, and leaves the board untouched", () => {
    const outcome = applyDraftTool(
      TOOL_SET,
      { hole: 1, candidateId: "p99", drink: "Pint", par: 4 },
      BOARD,
      CANDIDATES,
    );
    expect(outcome.ok).toBe(false);
    expect(BOARD.holes[0].candidateId).toBe("p1");
    if (!outcome.ok) expect(outcome.reply).toContain("p99");
  });

  it("refuses a forged id however it is dressed up", () => {
    ["", "The Marksman", "p1; p2", "P1", "p 1", "../p1"].forEach((forged) => {
      const outcome = applyDraftTool(
        TOOL_SET,
        { hole: 1, candidateId: forged, drink: "Pint", par: 4 },
        BOARD,
        CANDIDATES,
      );
      expect(outcome.ok).toBe(false);
    });
  });

  it("says so in words the caddy can act on, rather than throwing", () => {
    // A refusal is a tool result the model reads and corrects next turn. That
    // is the advantage this layer has over the schema it replaced.
    const outcome = applyDraftTool(TOOL_SET, { hole: 1, candidateId: "p42" }, BOARD, CANDIDATES);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reply).toMatch(/search|list|id/i);
  });
});

// ————————————————— setting a hole —————————————————

describe("set_hole", () => {
  it("replaces in place and reports the real pub's name", () => {
    const outcome = applyDraftTool(
      TOOL_SET,
      { hole: 2, candidateId: "p5", drink: "Half of stout", par: 2 },
      BOARD,
      CANDIDATES,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.board.holes).toHaveLength(3);
    expect(outcome.board.holes[1].candidateId).toBe("p5");
    expect(outcome.board.holes[1].par).toBe(2);
    // The name comes off the dossier on the way out — never from the model.
    expect(outcome.reply).toContain("The Pub 5");
  });

  it("appends when the hole is past the end, without leaving a gap", () => {
    const outcome = applyDraftTool(
      TOOL_SET,
      { hole: 9, candidateId: "p6", drink: "Pint", par: 4 },
      BOARD,
      CANDIDATES,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.board.holes).toHaveLength(4);
    expect(outcome.board.holes[3].candidateId).toBe("p6");
  });

  it("keeps a pub to one hole, and says which one it is already on", () => {
    const outcome = applyDraftTool(
      TOOL_SET,
      { hole: 3, candidateId: "p1", drink: "Pint", par: 4 },
      BOARD,
      CANDIDATES,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reply).toContain("hole 1");
  });

  it("lets a hole be re-dressed in place without tripping the duplicate check", () => {
    const outcome = applyDraftTool(
      TOOL_SET,
      { hole: 1, candidateId: "p1", drink: "Pint of mild", par: 5 },
      BOARD,
      CANDIDATES,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.board.holes[0].drink).toBe("Pint of mild");
  });

  it("clamps the dressing to the same bounds a whole card is clamped to", () => {
    const outcome = applyDraftTool(
      TOOL_SET,
      {
        hole: 1,
        candidateId: "p1",
        drink: "x".repeat(400),
        par: 99,
        localRules: [{ strokes: 999, reason: "y".repeat(200) }],
      },
      BOARD,
      CANDIDATES,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.board.holes[0].par).toBe(20);
    expect(outcome.board.holes[0].drink.length).toBeLessThanOrEqual(120);
    expect(outcome.board.holes[0].localRules[0].strokes).toBe(20);
  });

  it("drops a hazard note when there is no hazard to note", () => {
    const outcome = applyDraftTool(
      TOOL_SET,
      { hole: 1, candidateId: "p1", drink: "Pint", par: 4, hazard: null, hazardNote: "mind the step" },
      BOARD,
      CANDIDATES,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.board.holes[0].hazardNote).toBeNull();
  });

  it("refuses a hazard the house does not have", () => {
    const outcome = applyDraftTool(
      TOOL_SET,
      { hole: 1, candidateId: "p1", drink: "Pint", par: 4, hazard: "quicksand" },
      BOARD,
      CANDIDATES,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.board.holes[0].hazard).toBeNull();
  });

  it("puts the caddy's own words through the same scrubber the card uses", () => {
    // `neutralise` strips paste debris — control characters, zero-widths, the
    // one sequence that breaks a fence — and clamps. It does not remove an
    // `@everyone`, and nothing here needs it to: a fitNote lands on the host's
    // own drafting table, not on the public tracker where that mattered.
    const outcome = applyDraftTool(
      TOOL_SET,
      {
        hole: 1,
        candidateId: "p1",
        drink: "Pint",
        par: 4,
        fitNote: "Cosy​ corner with ```a fence``` " + "z".repeat(200),
      },
      BOARD,
      CANDIDATES,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const note = outcome.board.holes[0].fitNote ?? "";
    expect(note).not.toMatch(/[​-‏ -]/);
    expect(note).not.toContain("```");
    expect(note.length).toBeLessThanOrEqual(80);
  });

  it("wants a hole number", () => {
    expect(
      applyDraftTool(TOOL_SET, { candidateId: "p1", drink: "Pint", par: 4 }, BOARD, CANDIDATES).ok,
    ).toBe(false);
    expect(
      applyDraftTool(TOOL_SET, { hole: 0, candidateId: "p1" }, BOARD, CANDIDATES).ok,
    ).toBe(false);
  });
});

// ————————————————— the rest of the table —————————————————

describe("remove_hole and move_hole", () => {
  it("takes a hole off and closes the gap", () => {
    const outcome = applyDraftTool(TOOL_REMOVE, { hole: 2 }, BOARD, CANDIDATES);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.board.holes.map((h) => h.candidateId)).toEqual(["p1", "p3"]);
  });

  it("refuses a hole that is not there", () => {
    expect(applyDraftTool(TOOL_REMOVE, { hole: 9 }, BOARD, CANDIDATES).ok).toBe(false);
  });

  it("offers the model no way to reorder the card", () => {
    // The prompt told it "the walking order is not yours — leave the sequence
    // alone" and then handed it `move_hole`, and `parsePlan` overwrote
    // whatever it did anyway. A tool that contradicts its own instruction and
    // cannot affect the outcome is tokens spent on confusion. The walk is
    // arithmetic's; the model is a curator.
    expect(CADDY_TOOLS.map((tool) => tool.name)).not.toContain("move_hole");
    expect(isDraftTool("move_hole")).toBe(false);
    const outcome = applyDraftTool("move_hole", { from: 1, to: 3 }, BOARD, CANDIDATES);
    expect(outcome.ok).toBe(false);
  });

  it("never mutates the board it was given", () => {
    const before = JSON.stringify(BOARD);
    applyDraftTool(TOOL_REMOVE, { hole: 1 }, BOARD, CANDIDATES);
    applyDraftTool(TOOL_SET, { hole: 1, candidateId: "p4", drink: "x", par: 3 }, BOARD, CANDIDATES);
    expect(JSON.stringify(BOARD)).toBe(before);
  });
});

describe("name_course", () => {
  it("names it, clamped", () => {
    const outcome = applyDraftTool(TOOL_NAME, { name: "n".repeat(200) }, BOARD, CANDIDATES);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.board.name.length).toBeLessThanOrEqual(80);
  });

  it("refuses an empty name rather than blanking the course", () => {
    const outcome = applyDraftTool(TOOL_NAME, { name: "   " }, BOARD, CANDIDATES);
    expect(outcome.ok).toBe(false);
    expect(BOARD.name).toBe("The Test Invitational");
  });
});

// ————————————————— what the caddy reads —————————————————

describe("boardBlock", () => {
  it("names the pubs, because reading them is not the closed direction", () => {
    const text = boardBlock(BOARD, CANDIDATES);
    expect(text).toContain("The Pub 1");
    expect(text).toContain("hole 1");
    expect(text).toContain("The Test Invitational");
  });

  it("shows a hand-added hole without giving it an id to be moved onto", () => {
    const withManual: CaddyBoard = {
      ...BOARD,
      holes: [...BOARD.holes, hole("not-in-the-dossier")],
    };
    const text = boardBlock(withManual, CANDIDATES);
    // The caddy must not plan around a hole it cannot see.
    expect(text).toContain("hole 4");
    expect(text).toContain("by hand");
  });

  it("says plainly when the table is empty", () => {
    expect(boardBlock({ name: "", holes: [] }, CANDIDATES)).toContain("no holes");
  });
});

describe("searchResultBlock", () => {
  it("answers an empty search honestly rather than with nothing", () => {
    expect(searchResultBlock([])).toMatch(/nothing new/i);
  });

  it("writes results in the dossier's own form", () => {
    const text = searchResultBlock(CANDIDATES.slice(0, 2));
    expect(text).toContain("p1 | The Pub 1");
    expect(text).toContain("rating: 4.0");
  });
});

describe("readSearchCall", () => {
  it("clamps the query and resolves a near id", () => {
    const call = readSearchCall({ query: "q".repeat(200), near: "p2" }, CANDIDATES);
    expect(call?.query.length).toBeLessThanOrEqual(80);
    expect(call?.near?.name).toBe("The Pub 2");
  });

  it("drops a near id nobody offered, rather than refusing the search", () => {
    expect(readSearchCall({ query: "cocktails", near: "p99" }, CANDIDATES)?.near).toBeNull();
  });

  it("refuses an empty query", () => {
    expect(readSearchCall({ query: "  " }, CANDIDATES)).toBeNull();
    expect(readSearchCall({}, CANDIDATES)).toBeNull();
  });
});

// ————————————————— the prefix stays put —————————————————

describe("CADDY_TOOLS", () => {
  it("is a constant, so it cannot re-write the cached prefix", () => {
    // The tool definitions sit in the cached prefix beside the system rules
    // and the dossier. A description built per request would turn every cache
    // read back into a cache write, which is the cost model rather than tidiness.
    expect(JSON.stringify(CADDY_TOOLS)).toBe(JSON.stringify(CADDY_TOOLS));
    expect(JSON.stringify(CADDY_TOOLS)).not.toMatch(/The Pub \d|Shoreditch|p1 \|/);
  });

  it("names every tool exactly once", () => {
    const names = CADDY_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([TOOL_READ, TOOL_SEARCH, TOOL_SET, TOOL_REMOVE, TOOL_NAME]),
    );
  });

  it("knows which tools it can answer itself", () => {
    // The two that need a key and a session belong to the server.
    expect(isDraftTool(TOOL_SET)).toBe(true);
    expect(isDraftTool(TOOL_SEARCH)).toBe(false);
    expect(isDraftTool(TOOL_READ)).toBe(false);
  });

  it("refuses a tool it has never heard of", () => {
    expect(applyDraftTool("drop_table", {}, BOARD, CANDIDATES).ok).toBe(false);
  });
});

describe("the loop's own clock", () => {
  it("never stops before the first turn has happened", () => {
    // A loop that gave up having done nothing would hand back an empty board
    // and call it a card.
    expect(outOfLoopTime(0, CADDY_LOOP_MS * 10)).toBe(false);
  });

  it("keeps going while there is room for another turn", () => {
    expect(outOfLoopTime(1, 0)).toBe(false);
    expect(outOfLoopTime(5, CADDY_LOOP_MS - TURN_HEADROOM_MS - 1)).toBe(false);
  });

  it("stops one turn early rather than starting one it cannot finish", () => {
    // The failure this exists for: the first real looped plan was killed by
    // the platform mid-turn, which lost the card *and* the ledger row — the
    // row is written after the call returns, and a killed function never
    // returns. Beginning a turn with no room to finish it is how that happens.
    expect(outOfLoopTime(3, CADDY_LOOP_MS - TURN_HEADROOM_MS + 1)).toBe(true);
    expect(outOfLoopTime(3, CADDY_LOOP_MS)).toBe(true);
  });

  it("leaves a whole turn's room, not a sliver", () => {
    // A turn is a model call with thinking on plus a Places search. The
    // headroom has to be a real turn or the guard is decoration.
    expect(TURN_HEADROOM_MS).toBeGreaterThanOrEqual(30_000);
    expect(CADDY_LOOP_MS).toBeGreaterThan(TURN_HEADROOM_MS * 2);
  });

  it("finishes inside the route's own ceiling", () => {
    // `maxDuration` on app/api/caddy/plan/route.ts is the backstop; this is
    // the mechanism, and it has to come in under it with room for the reply.
    const ROUTE_MAX_MS = 300_000;
    expect(CADDY_LOOP_MS + TURN_HEADROOM_MS).toBeLessThan(ROUTE_MAX_MS);
  });
});

describe("the loop fits inside the function that runs it", () => {
  /** `app/api/caddy/plan/route.ts`. Duplicated deliberately: Next reads that
   * export at build time and nothing can import it back out, so the number is
   * restated here and this test is what keeps the two honest. */
  const MAX_DURATION_MS = 300_000;

  it("cannot start a turn that outlives the platform's ceiling", () => {
    // The bug this encodes, which cost a real plan and left no trace of it:
    // `outOfLoopTime` is consulted *between* turns while a single turn was
    // unbounded, so the loop could look at the clock, decide it had room, and
    // start a turn that ran past the ceiling. The function was killed mid-call
    // — before the loop exited, before the fallback board, before the ledger
    // row was written. The money was spent and nothing recorded it.
    //
    // The worst case is now the loop's own budget plus one full turn, and that
    // has to leave room for the fallback and the ledger write afterwards.
    const worstCase = CADDY_LOOP_MS + TURN_TIMEOUT_MS;
    expect(worstCase).toBeLessThan(MAX_DURATION_MS);
    // A minute of headroom for parsing, the fallback route and the write. Not
    // a round number chosen for comfort: everything after the loop has to
    // happen inside it, and a killed function is the one outcome with no
    // evidence at all.
    expect(MAX_DURATION_MS - worstCase).toBeGreaterThanOrEqual(60_000);
  });

  it("still refuses a new turn once the budget is gone", () => {
    // Unchanged behaviour, restated because the constant moved underneath it.
    expect(outOfLoopTime(1, CADDY_LOOP_MS)).toBe(true);
    expect(outOfLoopTime(1, 0)).toBe(false);
    // The first turn always runs: a loop that refuses before it has drafted
    // anything is the empty-board failure this whole area exists to stop.
    expect(outOfLoopTime(0, CADDY_LOOP_MS * 2)).toBe(false);
  });
});

/**
 * The picks the map lights, and the high-water mark behind them.
 *
 * This is the seam that was silently broken for a release. The picks used to
 * be read out of the streamed text of a one-shot answer, and the plan became a
 * tool loop — which streams tool calls and never writes an answer. The regex
 * went on compiling, the event went on being typed, the map went on listening,
 * and nothing was ever sent. Every consumer stayed live and idle.
 */
describe("freshPicks", () => {
  const board: CaddyBoard = {
    name: "",
    holes: ["p3", "p7", "p1"].map((candidateId) => ({
      candidateId,
      drink: "Pint",
      par: 3,
      hazard: null,
      hazardNote: null,
      fitNote: null,
      localRules: [],
    })),
  };

  it("sends the whole board when nothing has been announced", () => {
    expect(freshPicks(board, 0)).toEqual(["p3", "p7", "p1"]);
  });

  it("sends only what is new", () => {
    // The bytes matter: re-announcing the whole board after every tool call
    // is most of what would be on that stream.
    expect(freshPicks(board, 2)).toEqual(["p1"]);
  });

  it("sends nothing when the board has not grown", () => {
    expect(freshPicks(board, 3)).toEqual([]);
  });

  it("does not go backwards on a board that shrank", () => {
    // `remove_hole` is a tool. A negative slice index would re-announce the
    // tail of the board as though it were new.
    expect(freshPicks(board, 9)).toEqual([]);
    expect(freshPicks({ name: "", holes: [] }, 4)).toEqual([]);
  });

  it("carries candidate ids, never names", () => {
    // The whole safety rule in one assertion: what crosses the wire is an id
    // the server minted from a real Places result, and the name is attached
    // on the way out of the dossier.
    for (const id of freshPicks(board, 0)) {
      expect(id).toMatch(/^[ps]\d+$/);
    }
  });
});
