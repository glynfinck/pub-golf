import { TARIFF } from "@/lib/tariff";

/**
 * What the caddy is allowed to cost, and how that is counted.
 *
 * The green fee is one price for a day of caddy. The caddy's own bill is
 * per-token and unbounded by nature — a host who rolls a fresh card thirty
 * times is buying thirty cards at wholesale — so without a ceiling the
 * arithmetic runs the wrong way and a heavy user costs more than they paid.
 * This module is that ceiling, and it is expressed in money rather than in
 * turns, because turns are not what varies: an eighteen-hole plan with a tool
 * loop behind it can cost twenty times a one-word tweak, and metering both as
 * "one turn" prices neither.
 *
 * Three properties this is built for:
 *
 * **Integer arithmetic, all the way down.** Costs are micropence in `bigint`
 * territory — never floats, never rounded per-token — because the total is
 * summed in Postgres and compared against a limit, and a float sum that drifts
 * is a limit that means something slightly different every day.
 *
 * **The budget follows the price.** It is a share of the tariff, not a number
 * typed twice. Move the green fee and the allowance moves with it, in the same
 * commit, with no second place to forget.
 *
 * **It is rounded against us.** The exchange rate below is deliberately
 * pessimistic, so the recorded cost is never *less* than the real one. A
 * ceiling that flatters itself is not a ceiling.
 */

/**
 * Pence to the dollar, held as a constant on purpose.
 *
 * Anthropic bills in USD and the fee is set in GBP, so something has to bridge
 * them. A live rate would make the allowance wobble daily and make a test
 * impossible to write, so this is a fixed, deliberately unfavourable figure —
 * higher than the rate has been, so every conversion overstates what we owe
 * and the ceiling binds slightly early rather than slightly late. Worth a
 * glance if sterling moves a long way; nothing breaks if it is stale, the
 * caddy just gets marginally more or less rope than intended.
 */
export const PENCE_PER_USD = 80;

/** A model's list price, in USD per million tokens, exactly as
 * platform.claude.com/docs/en/about-claude/pricing states it. Kept in the
 * vendor's own units so it can be diffed against that page without arithmetic. */
export interface ModelPrice {
  input: number;
  /** The five-minute breakpoint, which is the one `client.ts` sets. */
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

/**
 * The board. Note what the numbers say: output is five times input on every
 * tier, and a cache read is a tenth of an ordinary one. Both facts are why the
 * caddy is shaped the way it is — a stable cached prefix and a short structured
 * answer — and both are why the cheap tiers are worth a look before the
 * ceiling is.
 *
 * Sonnet 5 is listed at its **standard** price, not the introductory one that
 * runs to 31 August 2026. Budgeting against a price that expires in weeks would
 * build in a cliff.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5": { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  "claude-sonnet-5": { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
};

/** The gateway prefixes a model id with its provider; the price is the same
 * model's either way, so the lookup takes the prefix off first. */
export function priceOf(model: string): ModelPrice | null {
  const bare = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
  return MODEL_PRICES[bare] ?? null;
}

/**
 * Micropence per token, from dollars per million tokens.
 *
 * The units line up exactly, which is the reason for choosing micropence:
 * a million tokens at $1 costs 100 pence, so one token costs 100 millionths of
 * a pence — and pence-per-million and micropence-per-token are the same number.
 * `$5/MTok` is therefore `400` micropence a token, with no scaling factor to
 * get backwards.
 */
export function microPencePerToken(usdPerMillion: number): number {
  return Math.ceil(usdPerMillion * PENCE_PER_USD);
}

/** One call's usage, as the Messages API reports it. */
export interface CaddyUsage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export const NO_USAGE: CaddyUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

/** Read the SDK's usage block, which names three of these differently and may
 * omit the cache pair entirely on a call that did not touch cache. */
export function readUsage(raw: unknown): CaddyUsage {
  if (typeof raw !== "object" || raw === null) return { ...NO_USAGE };
  const row = raw as Record<string, unknown>;
  const count = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };
  return {
    input: count(row.input_tokens),
    output: count(row.output_tokens),
    cacheWrite: count(row.cache_creation_input_tokens),
    cacheRead: count(row.cache_read_input_tokens),
  };
}

export function addUsage(a: CaddyUsage, b: CaddyUsage): CaddyUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

/**
 * What a call cost, in micropence. Integer throughout.
 *
 * An unknown model is priced at the dearest tier we know rather than at zero.
 * Free is the one wrong answer here: it would make an unrecognised model id —
 * a typo, a new release, a gateway alias — silently uncapped, which is exactly
 * the failure this module exists to prevent.
 */
export function costMicroPence(usage: CaddyUsage, model: string): number {
  const price = priceOf(model) ?? dearest();
  return (
    usage.input * microPencePerToken(price.input) +
    usage.output * microPencePerToken(price.output) +
    usage.cacheWrite * microPencePerToken(price.cacheWrite) +
    usage.cacheRead * microPencePerToken(price.cacheRead)
  );
}

function dearest(): ModelPrice {
  return Object.values(MODEL_PRICES).reduce((worst, price) =>
    price.output > worst.output ? price : worst,
  );
}

// ————————————————— the ceiling —————————————————

/**
 * How much of a green fee may go on the caddy's own bill.
 *
 * Twelve per cent of the sticker, which after tax and the card fee is roughly
 * fifteen of what actually lands. That is a real cost of goods and it is meant
 * to be: the caddy is the thing being sold. What it is not is open-ended — the
 * point of a share rather than a number is that a heavy day cannot cost more
 * than a light one earns.
 *
 * What that buys, at Opus prices and measured rather than guessed (the figures
 * are asserted in `tests/unit/caddy-budget.test.ts`): a fresh plan — a twelve
 * thousand token patch written to cache, three thousand tokens of answer —
 * costs a little over twelve pence, and a *roll* inside that same session about
 * half of it, because the patch is read back out of cache instead of bought
 * again. So the £4 fee covers three complete courses and £12 covers about a
 * dozen, or twice that in rolls. Comfortable for the ordinary night, and it is
 * the tail this exists for: thirty rolls against one fee is what "unlimited"
 * quietly means, and thirty is where the arithmetic turns over.
 *
 * If that headroom ever feels tight, the first lever is the model and not this
 * number. Output is five times input on every tier and dominates the bill, so
 * moving the caddy to Sonnet takes about forty per cent off without touching
 * the ceiling.
 */
export const CADDY_BUDGET_SHARE = 0.12;

/**
 * One planning conversation's own slice of that.
 *
 * Belt to the ceiling's braces, and aimed at a different failure: the tool loop
 * means a single ask can now spend many times in one breath, so a model that
 * starts pacing round the loop would otherwise burn the whole day's allowance
 * before any row was written. A third means a bad conversation costs a third of
 * the day, and the host still has two more.
 */
export const CADDY_CONVERSATION_SHARE = 1 / 3;

/** The day's allowance in micropence, from the fee in pence. */
export function caddyBudgetMicroPence(feePence: number = TARIFF.greenFee.amounts.gbp): number {
  return Math.floor(feePence * CADDY_BUDGET_SHARE * 1_000_000);
}

/** What one conversation may spend before it is wound up. */
export function conversationCapMicroPence(
  feePence: number = TARIFF.greenFee.amounts.gbp,
): number {
  return Math.floor(caddyBudgetMicroPence(feePence) * CADDY_CONVERSATION_SHARE);
}

/**
 * May another call be made? Checked *before* spending, with the cost of the
 * call about to be made unknown — so this is a "have you already had enough"
 * test, and the conversation cap plus `max_tokens` bound the overshoot.
 */
export function withinBudget(spentMicroPence: number, budgetMicroPence: number): boolean {
  return spentMicroPence < budgetMicroPence;
}

/**
 * The line a host reads when the allowance is gone.
 *
 * Names no number, no token, no penny and no model — the same discipline the
 * fair-use note keeps, and for the same reason: the covenant says money speaks
 * at round creation and the results afterglow, nowhere else. A host who has
 * worn out the caddy is told the drafting table is still theirs, because it is,
 * and every edit on it is free forever.
 */
export const CADDY_BUDGET_NOTE =
  "The caddy's done a full shift on this fee. The drafting table is all yours from here — every edit free, as always.";
