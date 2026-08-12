/**
 * Fair use: the backstop nobody is meant to meet.
 *
 * The caddy's *allowance* is counted and visible — a fee buys a course, four
 * re-designs and sixty tweaks, and `guard_caddy_spend` is what enforces that.
 * This is a different ceiling and a much higher one: a bound on **volume**,
 * armour against a script rather than against a person, held in Postgres where
 * a serverless function cannot outrun it.
 *
 * Hand-kept mirror of `public.caddy_fair_use_cap()`; the database is the
 * enforcement and this copy exists so the app can reason about the number and
 * write the one line of copy a host could ever see. A db test calls the
 * function and fails if the two drift apart — which is exactly what happened
 * when `20260913000000` raised the cap and this file went on saying 25, in a
 * branch where that tier has never run.
 */
export const CADDY_FAIR_USE_PER_DAY = 80;

/**
 * What the host reads if they ever get here. Names no number — the feature has
 * never shown them one, and inventing a figure at the moment of refusal would
 * be the first and worst time to start.
 *
 * **The one copy.** This sentence existed three times: here, in `budget.ts`,
 * and as a literal in `run.ts` — and only the literal rendered, so the two
 * kept carefully in step were the two nobody could read. `run.ts` imports this
 * one now.
 */
export const CADDY_FAIR_USE_NOTE =
  "The caddy's done a full shift on this fee. The drafting table is all yours from here — every edit free, as always.";

/**
 * Two functions used to sit here — `caddyTurnsSpent`, counting a rolling day
 * of turns, and `caddyFairUseSpent`, comparing that to the cap. Neither was
 * ever called: the trigger does the counting, in the only place a count can be
 * trusted, and the app reads its `42501`.
 *
 * They were written to mirror the trigger's comparison and they proved nothing
 * about it — a mirror only holds if something compares the two, and what does
 * that is the db test on `caddy_fair_use_cap()` above, which needs the constant
 * and not the arithmetic.
 */
