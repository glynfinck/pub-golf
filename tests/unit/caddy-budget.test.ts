import { describe, expect, it } from "vitest";

import {
  CADDY_COURSES_PER_FEE,
  coursesLeftNote,
} from "@/lib/caddy/credits";
import {
  CADDY_BUDGET_NOTE,
  CADDY_BUDGET_SHARE,
  CADDY_CONVERSATION_SHARE,
  MODEL_PRICES,
  NO_USAGE,
  PENCE_PER_USD,
  addUsage,
  caddyBudgetMicroPence,
  conversationCapMicroPence,
  costMicroPence,
  microPencePerToken,
  priceOf,
  readUsage,
  sumUsage,
  type CaddyUsage,
  withinBudget,
} from "@/lib/caddy/budget";
import { TARIFF } from "@/lib/tariff";

describe("microPencePerToken", () => {
  it("makes pence-per-million and micropence-per-token the same number", () => {
    // The identity the unit choice rests on. $5/MTok at 80p to the dollar is
    // 400 pence per million tokens, which is 400 micropence a token.
    expect(microPencePerToken(5)).toBe(5 * PENCE_PER_USD);
    expect(microPencePerToken(5)).toBe(400);
    expect(microPencePerToken(0.5)).toBe(40);
  });

  it("rounds up, so a fractional rate never costs us less than it does", () => {
    expect(microPencePerToken(6.25)).toBe(500);
    expect(microPencePerToken(0.3)).toBe(24);
    // A rate that does not divide cleanly still lands above the true figure.
    expect(microPencePerToken(0.001)).toBeGreaterThanOrEqual(0.001 * PENCE_PER_USD);
  });
});

describe("priceOf", () => {
  it("prices a model the same through the gateway as direct", () => {
    // The gateway carries the provider on the id. Same model, same bill.
    expect(priceOf("anthropic/claude-opus-5")).toEqual(priceOf("claude-opus-5"));
  });

  it("knows nothing about a model it has never heard of", () => {
    expect(priceOf("acme/whisper-9")).toBeNull();
  });

  it("carries the vendor's own published numbers", () => {
    // Diffable against platform.claude.com without arithmetic.
    expect(MODEL_PRICES["claude-opus-5"]).toEqual({
      input: 5,
      cacheWrite: 6.25,
      cacheRead: 0.5,
      output: 25,
    });
  });

  it("prices a cache read at a tenth of an ordinary input token", () => {
    // The whole reason the dossier is byte-stable. If this stops being true,
    // the "ask as often as you like" economics need re-deriving.
    Object.values(MODEL_PRICES).forEach((price) => {
      expect(price.cacheRead).toBeCloseTo(price.input * 0.1, 5);
    });
  });
});

describe("costMicroPence", () => {
  const usage: CaddyUsage = { input: 1_000, output: 1_000, cacheWrite: 1_000, cacheRead: 1_000 };

  it("adds the four lines in integer micropence", () => {
    // 1000 × (400 + 2000 + 500 + 40)
    expect(costMicroPence(usage, "claude-opus-5")).toBe(1_000 * (400 + 2000 + 500 + 40));
    expect(Number.isInteger(costMicroPence(usage, "claude-opus-5"))).toBe(true);
  });

  it("costs nothing for no usage", () => {
    expect(costMicroPence(NO_USAGE, "claude-opus-5")).toBe(0);
  });

  it("prices an unknown model at the dearest tier, never at zero", () => {
    // The load-bearing one. A typo, a new release or a gateway alias must not
    // become an uncapped model — free is the single wrong answer here.
    const unknown = costMicroPence(usage, "acme/whisper-9");
    expect(unknown).toBeGreaterThan(0);
    const known = Object.keys(MODEL_PRICES).map((model) => costMicroPence(usage, model));
    expect(unknown).toBe(Math.max(...known));
  });

  it("makes the cheaper tiers visibly cheaper", () => {
    expect(costMicroPence(usage, "claude-sonnet-5")).toBeLessThan(
      costMicroPence(usage, "claude-opus-5"),
    );
    expect(costMicroPence(usage, "claude-haiku-4-5-20251001")).toBeLessThan(
      costMicroPence(usage, "claude-sonnet-5"),
    );
  });
});

describe("readUsage", () => {
  it("reads the Messages API's own field names", () => {
    expect(
      readUsage({
        input_tokens: 12,
        output_tokens: 34,
        cache_creation_input_tokens: 56,
        cache_read_input_tokens: 78,
      }),
    ).toEqual({ input: 12, output: 34, cacheWrite: 56, cacheRead: 78 });
  });

  it("reads a call that never touched cache", () => {
    expect(readUsage({ input_tokens: 10, output_tokens: 5 })).toEqual({
      input: 10,
      output: 5,
      cacheWrite: 0,
      cacheRead: 0,
    });
  });

  it("treats nonsense as nothing rather than as NaN", () => {
    // A NaN here would poison the running total and disable the ceiling.
    expect(readUsage(null)).toEqual(NO_USAGE);
    expect(readUsage(undefined)).toEqual(NO_USAGE);
    expect(readUsage({ input_tokens: "lots", output_tokens: -5 })).toEqual(NO_USAGE);
    expect(Number.isFinite(costMicroPence(readUsage("nope"), "claude-opus-5"))).toBe(true);
  });
});

describe("addUsage", () => {
  it("accumulates a tool loop's turns", () => {
    const a: CaddyUsage = { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 };
    expect(addUsage(addUsage(NO_USAGE, a), a)).toEqual({
      input: 2,
      output: 4,
      cacheWrite: 6,
      cacheRead: 8,
    });
  });
});

describe("the ceiling", () => {
  it("is a share of the fee, so moving the price moves the allowance", () => {
    // The reason it is a share and not a number: there is no second place to
    // forget when the green fee changes.
    expect(caddyBudgetMicroPence(1200)).toBe(3 * caddyBudgetMicroPence(400));
    expect(caddyBudgetMicroPence(400)).toBe(400 * CADDY_BUDGET_SHARE * 1_000_000);
  });

  it("defaults to the tariff actually in force", () => {
    expect(caddyBudgetMicroPence()).toBe(caddyBudgetMicroPence(TARIFF.greenFee.amounts.gbp));
  });

  it("gives one conversation a third of the day", () => {
    expect(conversationCapMicroPence(1200)).toBe(
      Math.floor(caddyBudgetMicroPence(1200) * CADDY_CONVERSATION_SHARE),
    );
    expect(conversationCapMicroPence(1200)).toBeLessThan(caddyBudgetMicroPence(1200));
  });

  it("leaves the ordinary night nowhere near it", () => {
    // A fresh plan: a 12k-token cached prefix written once, 3k of answer.
    const plan = costMicroPence(
      { input: 500, output: 3_000, cacheWrite: 12_000, cacheRead: 0 },
      "claude-opus-5",
    );
    // A roll inside that session reads the same patch back instead of buying
    // it again, which is the whole point of the byte-stable dossier.
    const roll = costMicroPence(
      { input: 500, output: 3_000, cacheWrite: 0, cacheRead: 12_000 },
      "claude-opus-5",
    );
    expect(roll).toBeLessThan(plan);

    // Three complete courses at the £4 fee, a dozen at £12 — and roughly
    // twenty rolls, since a roll is a little over half a fresh plan.
    expect(plan * 3).toBeLessThan(caddyBudgetMicroPence(400));
    expect(plan * 11).toBeLessThan(caddyBudgetMicroPence(1200));
    expect(roll * 20).toBeLessThan(caddyBudgetMicroPence(1200));
  });

  it("does bind on a tail that would otherwise outrun the fee", () => {
    // Thirty full plans is what "unlimited rolls" quietly means, and at Opus
    // prices that is real money against a single fee.
    const plan = costMicroPence(
      { input: 500, output: 3_000, cacheWrite: 12_000, cacheRead: 0 },
      "claude-opus-5",
    );
    expect(withinBudget(plan * 30, caddyBudgetMicroPence(400))).toBe(false);
  });

  it("spends up to the line and not past it", () => {
    expect(withinBudget(0, 100)).toBe(true);
    expect(withinBudget(99, 100)).toBe(true);
    expect(withinBudget(100, 100)).toBe(false);
    expect(withinBudget(101, 100)).toBe(false);
  });
});

describe("CADDY_BUDGET_NOTE", () => {
  it("names no number", () => {
    // Same discipline as the fair-use note: the covenant lets money speak at
    // round creation and the results afterglow, and nowhere else.
    expect(CADDY_BUDGET_NOTE).not.toMatch(/\d/);
  });

  it("says the table is still theirs", () => {
    expect(CADDY_BUDGET_NOTE).toMatch(/free/i);
  });
});

describe("summing a tool loop into one bill", () => {
  const call = (over: Partial<CaddyUsage> = {}): CaddyUsage => ({
    input: 100,
    output: 200,
    cacheWrite: 0,
    cacheRead: 1_000,
    ...over,
  });

  it("adds every field, so nothing in a loop goes unbilled", () => {
    expect(addUsage(call(), call({ output: 50 }))).toEqual({
      input: 200,
      output: 250,
      cacheWrite: 0,
      cacheRead: 2_000,
    });
  });

  it("sums an empty loop to nothing rather than to undefined", () => {
    expect(sumUsage([])).toEqual(NO_USAGE);
  });

  it("keeps the cache write the first call paid for", () => {
    // The failure mode this guards: every call after the first is mostly cache
    // *reads*, an order of magnitude cheaper than the write that seeded them.
    // A total that kept only the last call's usage would price a twelve-turn
    // plan as a one-turn one — undercharging, which is the direction that
    // silently breaks the budget.
    const loop = [call({ cacheWrite: 20_000, cacheRead: 0 }), call(), call()];
    const total = sumUsage(loop);
    expect(total.cacheWrite).toBe(20_000);
    expect(costMicroPence(total, "claude-sonnet-5")).toBeGreaterThan(
      costMicroPence(call(), "claude-sonnet-5"),
    );
  });

  it("bills a loop as one turn, and that turn costs more than one call", () => {
    // One plan is one thing the host asked for and stays one ledger row. What
    // must not happen is the row understating what the loop actually spent.
    const loop = Array.from({ length: 8 }, () => call());
    const total = sumUsage(loop);
    expect(costMicroPence(total, "claude-sonnet-5")).toBe(
      8 * costMicroPence(call(), "claude-sonnet-5"),
    );
  });

  it("leaves a loop of one exactly where a single call already was", () => {
    expect(sumUsage([call()])).toEqual(call());
  });
});

describe("what a fee buys, counted", () => {
  it("buys more than one course, and not so many it stops meaning anything", () => {
    // The number is a product decision, not arithmetic — this only holds it
    // inside the range where it is still a fee for a night out rather than a
    // subscription. `tests/db` proves it equals the database's own copy.
    expect(CADDY_COURSES_PER_FEE).toBeGreaterThan(1);
    expect(CADDY_COURSES_PER_FEE).toBeLessThanOrEqual(10);
  });

  it("can afford every course it sells", () => {
    // The credit ceiling and the money ceiling have to agree: selling three
    // courses on a budget that funds two is a host refused mid-fee by a
    // number nobody told them about. A plan is roughly a conversation's cap.
    const perPlan = conversationCapMicroPence();
    expect(perPlan * CADDY_COURSES_PER_FEE).toBeLessThanOrEqual(
      caddyBudgetMicroPence(),
    );
  });

  it("says how many are left in words, never as a bare digit", () => {
    expect(coursesLeftNote(0)).toMatch(/no courses left/i);
    expect(coursesLeftNote(1)).toMatch(/one course left/i);
    expect(coursesLeftNote(3)).toMatch(/^3 courses left/i);
  });
});
