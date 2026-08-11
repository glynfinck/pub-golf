import type { BrowserContext } from "@playwright/test";

/**
 * Harness concerns: what a test is allowed to take, and how it puts the
 * furniture back.
 *
 * Both exist because of the same run of red CI. Four failures across four
 * runs, in the two heaviest specs, on the two slowest engines — and every
 * one of them a *timeout*, never a wrong answer:
 *
 *   foursome     iphone-safari    "Test timeout of 150000ms exceeded"
 *   foursome     desktop-firefox  expect 15s, the forfeit line
 *   foursome     iphone-safari    (same spec again)
 *   full-house   iphone-safari    the 300s budget, landing in the finally
 *
 * Nothing asserted the wrong thing. The budgets were sized on a developer's
 * machine and then handed unchanged to a two-core GitHub runner playing a
 * three-engine matrix against a full local Supabase stack — Postgres,
 * PostgREST, Realtime, a Next server and WebKit, all on the same two cores.
 */

/**
 * How much longer everything is allowed to take on CI.
 *
 * Doubling is not "make the red go away": these tests wait on a realtime
 * event, a server render and a hydration, and on a contended runner each of
 * those is several times what it costs locally. A test that is genuinely
 * broken still never arrives, so the assertions keep their meaning; what
 * changes is that a slow machine stops being reported as a bug.
 *
 * Local stays 1×, deliberately. A round that has gone properly slow should
 * still be caught by somebody running the suite on a real machine, and the
 * moment this multiplier applies everywhere it stops measuring anything.
 */
export const CI_SLOWDOWN = process.env.CI ? 2 : 1;

/** A per-test budget, scaled for wherever it is running. */
export function budget(ms: number): number {
  return ms * CI_SLOWDOWN;
}

/**
 * Close browser contexts without letting cleanup decide the verdict.
 *
 * `full-house` failed at `await hostContext.close()` inside its own `finally`
 * — the test's budget expired and the timeout was simply attributed to
 * whatever line was executing, which happened to be teardown. The report then
 * blamed a close, which is the one thing in that test that cannot be wrong:
 * every assertion had already passed.
 *
 * A context that will not shut politely is a browser problem, and it is not
 * the question any of these specs are asking. Close everything, in parallel
 * so a slow one does not hold up the rest, and swallow what comes back.
 */
export async function closeQuietly(
  ...contexts: readonly BrowserContext[]
): Promise<void> {
  await Promise.all(
    contexts.map((context) => context.close().catch(() => {})),
  );
}
