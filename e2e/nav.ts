import { expect, type Locator, type Page } from "@playwright/test";

/**
 * How long to keep re-trying a settle-then-act block before giving up.
 *
 * Deliberately left at the double-mount beat: what these blocks wait on is
 * Next holding the outgoing and incoming view together, not a phone catching
 * up on a dropped realtime event. `holeOutToResults` below is the one that
 * waits on the catch-up, and it says so with its own budget.
 */
const SETTLE_TIMEOUT = 15_000;

/**
 * How long the terminal hole-out may take to land on /results.
 *
 * Longer than SETTLE_TIMEOUT because this is the last step and no later
 * assertion can absorb a slow file — and derived from the same arithmetic as
 * playwright.config.ts's expect timeout, because arriving here means waiting
 * on a write that travels as a realtime event, and a dropped one cannot even
 * begin to catch up for
 *
 *   POLL_MS               10s  the safety-net poll in use-live-round.ts
 *   ACTION_QUIET_CAP_MS   15s  the deferral in lib/action-window.ts
 *                        ----
 *                         25s  before the refetch is even allowed to start
 *
 * A flat 30s left about five seconds of that budget for an RSC fetch, a
 * server render and a hydration — the same five seconds the config was
 * raised off, and for the same reason, but this helper carries its own
 * number and so never saw that fix. `foursome` on WebKit spends it just
 * being four phones on a two-core runner hosting Postgres, PostgREST,
 * Realtime, Next and WebKit at once.
 *
 * Raising it absorbs latency, not wrongness: a card that never files still
 * fails, and one that files with the wrong standings fails in the assertions
 * after it. What it must never become is a number picked to make a red go
 * away, which is why the arithmetic is written out rather than the result.
 */
const FILE_THE_CARD_TIMEOUT = process.env.CI ? 60_000 : 30_000;

/**
 * Exactly one copy of `testId`, visible, at one instant.
 *
 * A realtime event fires router.refresh() while a navigation is already in
 * flight, so Next mounts the outgoing and incoming view together for a beat
 * — Firefox and WebKit hold that pair longest — and a bare getByTestId hits
 * a strict-mode violation. The subtlety that cost two CI flakes: asserting
 * the count and THEN acting is not atomic. The count passes, the second
 * copy mounts, and the act explodes on a locator that was single a
 * millisecond ago. Both halves have to retry as one block, which is what
 * toPass gives us.
 *
 * Counting beats reaching for .first(): if a duplicate ever stops being
 * transient — a genuine double mount, which would mean two live-round
 * subscriptions — the whole block times out and says so, rather than
 * quietly driving a stale node.
 */
export async function expectSettled(
  page: Page,
  testId: string,
  /** Anything further to assert about it, inside the same retried block. */
  andAlso?: (control: Locator) => Promise<unknown>,
) {
  await expect(async () => {
    const control = page.getByTestId(testId);
    await expect(control).toHaveCount(1);
    await expect(control).toBeVisible({ timeout: 1_000 });
    await andAlso?.(control);
  }).toPass({ timeout: SETTLE_TIMEOUT });
}

/**
 * Click a control once the page has settled to exactly one copy of it.
 *
 * Same atomicity rule as expectSettled: the count and the click retry
 * together. The click is the last statement in the block, so a retry only
 * ever follows a click that did not land.
 */
export async function clickSettled(page: Page, testId: string) {
  await expect(async () => {
    const control = page.getByTestId(testId);
    await expect(control).toHaveCount(1);
    await control.click({ timeout: 2_000 });
  }).toPass({ timeout: SETTLE_TIMEOUT });
}

/**
 * Call the last hole and stay on the tap until the card files.
 *
 * The final hole-out is the one tap the suite aims into the debounce storm
 * on purpose: every phone's last swig echoes back as a re-render right as
 * the official reaches for the button, so the tap can land on the outgoing
 * copy — heard by Playwright, never by React — or the action can catch a
 * bad beat and toast its error, leaving the round live. A person answers
 * both the same way: look up, still on the hole, tap again. Arrival on
 * /results is the receipt, so the click only fires while the official is
 * still on the play screen — and a double advanceHole on the last hole
 * re-files the same finished card, so a tap that raced the navigation
 * costs nothing. The runway is longer than SETTLE_TIMEOUT because this is
 * the terminal step: there is no later assertion to absorb a slow file.
 */
export async function holeOutToResults(official: Page, code: string) {
  const results = new RegExp(`/round/${code}/results`);
  await expect(async () => {
    if (!results.test(official.url())) {
      await official.getByTestId("hole-out").click({ timeout: 2_000 });
    }
    await expect(official).toHaveURL(results, { timeout: 3_000 });
  }).toPass({ timeout: FILE_THE_CARD_TIMEOUT });
}

/**
 * page.goto, but at peace with a live app.
 *
 * Every round screen refreshes itself whenever realtime lands a change, and
 * a hard navigation that collides with one is reported engine by engine:
 * Chromium shrugs, WebKit throws "interrupted by another navigation" — or
 * "Frame load interrupted", its other spelling for the same collision —
 * and Firefox NS_BINDING_ABORTED. A person in that collision simply arrives
 * on one of the two destinations — so retry the way a thumb would, and only
 * surface errors that are not the collision.
 */
export async function gotoSettled(page: Page, url: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await page.goto(url);
      return;
    } catch (error) {
      const collision =
        /interrupted by another navigation|Frame load interrupted|NS_BINDING_ABORTED|frame was detached/i.test(
          String(error),
        );
      if (!collision || attempt >= 2) throw error;
    }
  }
}
