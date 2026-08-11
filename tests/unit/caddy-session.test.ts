import { describe, expect, it, vi } from "vitest";

import { dispatchTool, type ToolContext } from "@/lib/caddy/session";
import {
  CADDY_TOOLS,
  TOOL_NAME,
  TOOL_READ,
  TOOL_ROUTE,
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
