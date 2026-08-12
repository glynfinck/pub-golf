import { describe, expect, it, vi } from "vitest";

import { dispatchTool, type ToolContext } from "@/lib/caddy/session";
import {
  CADDY_TOOLS,
  SEARCH_RESULTS_MAX,
  TOOL_EXCLUDE,
  TOOL_KEEP,
  TOOL_NAME,
  TOOL_READ,
  TOOL_RESTORE,
  TOOL_ROUTE,
  TOOL_ROUTES,
  TOOL_SEARCH,
  TOOL_SET,
  type CaddyBoard,
} from "@/lib/caddy/tools";
import type { CandidateDossier } from "@/lib/caddy/dossier";
import { EMPTY_FACTS } from "@/lib/caddy/dossier";

const pub = (id: string, name: string, x: number, y: number): CandidateDossier => ({
  id,
  venueId: `venue-${id}`,
  name,
  address: "1 Somewhere Street",
  rating: 4.2,
  reviewCount: 100,
  lat: 51.5 + y * 0.003,
  lng: -0.08 + x * 0.003,
  priceLevel: 2,
  facts: { ...EMPTY_FACTS },
  editorial: null,
  reviews: [],
});

const candidates = [
  pub("p1", "The Old Blue Last", 0, 0),
  pub("p2", "Nancy Spains", 0.2, 0),
  pub("p3", "The Fox", 12, 0),
];

const board: CaddyBoard = {
  name: "The Shoreditch Six",
  holes: [
    {
      candidateId: "p1",
      drink: "Pint of stout",
      par: 5,
      hazard: null,
      hazardNote: null,
      fitNote: null,
      localRules: [],
    },
    {
      candidateId: "p2",
      drink: "Whiskey shot",
      par: 2,
      hazard: "bunker",
      hazardNote: null,
      fitNote: null,
      localRules: [],
    },
  ],
};

function context(over: Partial<ToolContext> = {}): ToolContext {
  return {
    board,
    candidates,
    pins: { minLegMinutes: 5 },
    search: vi.fn(async () => []),
    excluded: new Map(),
    drafts: [],
    holes: 6,
    aim: {},
    ...over,
  };
}

describe("dispatching a tool call", () => {
  it("hands back the table when asked to read it", async () => {
    const answer = await dispatchTool(TOOL_READ, {}, context());
    expect(answer.reply).toContain("The Old Blue Last");
    expect(answer.board).toEqual(board);
  });

  it("goes back to Google, and folds what it finds into the dossier", async () => {
    // The one thing the single-shot plan genuinely cannot do: the caddy is
    // handed one gather and, asked for a garden nobody in it has, can only
    // pick the least-bad. `added` is what the *next* turn is checked against
    // — without it the caddy is offered pubs it is then refused for using.
    const found = [pub("p9", "The Beer Garden", 6, 2)];
    const search = vi.fn(async () => found);
    const answer = await dispatchTool(TOOL_SEARCH, { query: "beer garden" }, context({ search }));
    expect(search).toHaveBeenCalledWith("beer garden");
    expect(answer.added).toEqual(found);
    expect(answer.reply).toContain("The Beer Garden");
    expect(answer.narration).toBe("Looking for beer garden");
  });

  it("caps what a follow-up search may bring back", async () => {
    // A follow-up ("anywhere with a garden?"), not a second gather. The cap
    // has to be the same for the reply and for `added` — a pub named in the
    // tool result that did not reach the dossier is one the caddy is offered
    // and then refused for using.
    const many = Array.from({ length: 20 }, (_, i) => pub(`x${i}`, `Pub ${i}`, i, 1));
    const answer = await dispatchTool(
      TOOL_SEARCH,
      { query: "garden" },
      context({ search: vi.fn(async () => many) }),
    );
    expect(answer.added).toHaveLength(SEARCH_RESULTS_MAX);
    expect(answer.reply).toContain("Pub 0");
    expect(answer.reply).not.toContain("Pub 19");
  });

  it("answers an empty search rather than calling Google with nothing", async () => {
    const search = vi.fn(async () => []);
    const answer = await dispatchTool(TOOL_SEARCH, { query: "   " }, context({ search }));
    expect(search).not.toHaveBeenCalled();
    expect(answer.reply).toMatch(/empty/i);
  });

  it("routes the table and reports what it walks like", async () => {
    const answer = await dispatchTool(TOOL_ROUTE, {}, context());
    expect(answer.reply).toContain("ROUTED");
    expect(answer.reply).toContain("total walk");
  });

  it("names a huddle in words the caddy can act on", async () => {
    // p1 and p2 are 40 metres apart with a five-minute minimum. The point is
    // that the caddy finds this out *before* handing the card over, which is
    // the whole reason the tool exists.
    const answer = await dispatchTool(
      TOOL_ROUTE,
      { candidateIds: ["p1", "p2", "p3"] },
      context(),
    );
    expect(answer.reply).toMatch(/under the minimum/);
  });

  it("routes a set the caddy has not committed to", async () => {
    const answer = await dispatchTool(TOOL_ROUTE, { candidateIds: ["p1", "p3"] }, context());
    expect(answer.reply).toContain("ROUTED");
    // p2 is on the board but not in this trial, so it must not appear.
    expect(answer.reply).not.toContain("Nancy Spains");
  });

  it("says there is nothing to route rather than routing one pub", async () => {
    const answer = await dispatchTool(
      TOOL_ROUTE,
      {},
      context({ board: { name: "", holes: [] } }),
    );
    expect(answer.reply).toMatch(/nothing to route/i);
  });

  it("applies a draft change and hands the new table back", async () => {
    const answer = await dispatchTool(TOOL_NAME, { name: "The Hoxton Nine" }, context());
    expect(answer.board.name).toBe("The Hoxton Nine");
  });

  it("refuses a pub nobody offered, and leaves the table untouched", async () => {
    // The rule the whole feature rests on, at the layer that now enforces it.
    // A schema could only make this unrepresentable; here it comes back as a
    // sentence the caddy reads and corrects.
    const answer = await dispatchTool(
      TOOL_SET,
      { hole: 1, candidateId: "p404", drink: "Pint", par: 4 },
      context(),
    );
    expect(answer.board).toEqual(board);
    expect(answer.reply.length).toBeGreaterThan(10);
  });

  it("answers a tool nobody registered instead of ending the plan", async () => {
    // A hallucinated call must not throw away a plan the host has paid for.
    const answer = await dispatchTool("book_a_taxi", {}, context());
    expect(answer.board).toEqual(board);
    expect(answer.reply).toContain("book_a_taxi");
  });

  it("can answer every tool it is given", async () => {
    // The registry and the dispatcher drifting apart would show up as a tool
    // the caddy can call and nothing can serve — a dead end mid-plan.
    for (const tool of CADDY_TOOLS) {
      const answer = await dispatchTool(tool.name, {}, context());
      expect(answer.reply).not.toContain("There is no tool called");
    }
  });
});

/**
 * The curator's tools.
 *
 * The division of labour this branch settled on: the algorithm plans the walk
 * and the caddy chooses between walks, swaps a pub that does not fit and asks
 * for another set without it. Every one of those is a pure call over the
 * candidates already gathered, which is why they are all provable here — the
 * model is the one part that cannot be, and it is not the part doing the
 * routing.
 */
describe("planning, ruling out and keeping drafts", () => {
  const patch = [
    pub("q1", "The First", 0, 0),
    pub("q2", "The Second", 2, 0.5),
    pub("q3", "The Third", 4, 0),
    pub("q4", "The Fourth", 6, 0.5),
    pub("q5", "The Fifth", 8, 0),
    pub("q6", "The Sixth", 10, 0.5),
    pub("q7", "The Seventh", 12, 0),
  ];

  it("hands back whole walks rather than one leg at a time", async () => {
    const answer = await dispatchTool(
      TOOL_ROUTES,
      {},
      context({ candidates: patch, holes: 5 }),
    );
    expect(answer.reply).toContain("<routes>");
    expect(answer.reply).toContain("R1");
    expect(answer.narration).toBe("Working out some walks");
  });

  it("leaves excluded pubs out of every walk it offers", async () => {
    // The point of remembering a refusal: "another one, without those" has to
    // be a single call, or the caddy re-offers what it has already rejected.
    const excluded = new Map([["q3", "no garden"]]);
    const answer = await dispatchTool(
      TOOL_ROUTES,
      {},
      context({ candidates: patch, holes: 5, excluded }),
    );
    const routes = answer.reply
      .split("\n")
      .filter((line) => /^R\d+ /.test(line));
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) expect(route).not.toContain("q3");
  });

  it("honours a pin the caddy is entitled to make", async () => {
    const answer = await dispatchTool(
      TOOL_ROUTES,
      { startNear: "q1", finishNear: "q7" },
      context({ candidates: patch, holes: 5 }),
    );
    for (const line of answer.reply.split("\n").filter((l) => /^R\d+ /.test(l))) {
      const stops = line.slice(line.indexOf("]") + 2, line.indexOf(" |")).split(" > ");
      expect(stops[0]).toBe("q1");
      expect(stops.at(-1)).toBe("q7");
    }
  });

  it("ignores a pin on a pub it has just ruled out", async () => {
    // Passing it down would have the graph drop it silently, and the caddy
    // would never learn the walk it asked for is not the walk it got.
    const excluded = new Map([["q1", "shut on Mondays"]]);
    const answer = await dispatchTool(
      TOOL_ROUTES,
      { startNear: "q1" },
      context({ candidates: patch, holes: 4, excluded }),
    );
    for (const line of answer.reply.split("\n").filter((l) => /^R\d+ /.test(l))) {
      expect(line).not.toContain("q1");
    }
  });

  it("says so rather than routing thin air", async () => {
    const excluded = new Map(patch.slice(1).map((p) => [p.id, "no"] as const));
    const answer = await dispatchTool(
      TOOL_ROUTES,
      {},
      context({ candidates: patch, excluded: new Map(excluded) }),
    );
    expect(answer.reply).toMatch(/not enough pubs/i);
  });

  it("remembers a pub it has ruled out", async () => {
    const excluded = new Map<string, string>();
    const answer = await dispatchTool(
      TOOL_EXCLUDE,
      { candidateIds: ["p1", "p3"], why: "no garden" },
      context({ excluded }),
    );
    expect(excluded.get("p1")).toBe("no garden");
    expect(excluded.get("p3")).toBe("no garden");
    expect(answer.reply).toContain("2 pubs");
  });

  it("refuses to rule out a pub nobody offered", async () => {
    // The same rule as `set_hole`, on a second door: no tool anywhere accepts
    // an id the server did not mint, whichever direction it points.
    const excluded = new Map<string, string>();
    const answer = await dispatchTool(
      TOOL_EXCLUDE,
      { candidateIds: ["p404"], why: "made up" },
      context({ excluded }),
    );
    expect(excluded.size).toBe(0);
    expect(answer.reply).toMatch(/none of those/i);
  });

  it("keeps a draft and puts it back exactly", async () => {
    const drafts: { note: string; board: CaddyBoard }[] = [];
    const kept = await dispatchTool(
      TOOL_KEEP,
      { note: "the quiet one" },
      context({ drafts }),
    );
    expect(kept.reply).toContain("the quiet one");
    expect(drafts).toHaveLength(1);

    // The caddy tries something and does not like it.
    const worse = await dispatchTool(
      TOOL_NAME,
      { name: "Something Worse" },
      context({ drafts, board: kept.board }),
    );
    expect(worse.board.name).toBe("Something Worse");

    const back = await dispatchTool(
      TOOL_RESTORE,
      { draft: 1 },
      context({ drafts, board: worse.board }),
    );
    expect(back.board).toEqual(board);
  });

  it("answers a restore with nothing kept instead of clearing the table", async () => {
    const answer = await dispatchTool(TOOL_RESTORE, { draft: 1 }, context({ drafts: [] }));
    expect(answer.board).toEqual(board);
    expect(answer.reply).toMatch(/nothing has been kept/i);
  });

  it("answers a restore of a draft that does not exist", async () => {
    const drafts = [{ note: "only one", board }];
    const answer = await dispatchTool(TOOL_RESTORE, { draft: 4 }, context({ drafts }));
    expect(answer.board).toEqual(board);
    expect(answer.reply).toContain("1 drafts");
  });
});
