import { expect, type Locator, type Page } from "@playwright/test";

/** How long to keep re-trying a settle-then-act block before giving up. */
const SETTLE_TIMEOUT = 15_000;

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
  }).toPass({ timeout: 30_000 });
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
