import { expect, type Page } from "@playwright/test";

/**
 * Click a control once the page has settled to exactly one copy of it.
 *
 * A realtime event fires router.refresh() while a navigation is already in
 * flight, so for a moment the outgoing and incoming views are both mounted
 * and a bare getByTestId matches twice — Firefox holds the pair longest.
 * Waiting for the count beats picking .first(): if a duplicate ever stops
 * being transient — a genuine double mount, which would mean two live-round
 * subscriptions — this fails instead of quietly clicking a stale node.
 */
export async function clickSettled(page: Page, testId: string) {
  const control = page.getByTestId(testId);
  await expect(control).toHaveCount(1);
  await control.click();
}

/**
 * page.goto, but at peace with a live app.
 *
 * Every round screen refreshes itself whenever realtime lands a change, and
 * a hard navigation that collides with one is reported engine by engine:
 * Chromium shrugs, WebKit throws "interrupted by another navigation",
 * Firefox NS_BINDING_ABORTED. A person in that collision simply arrives on
 * one of the two destinations — so retry the way a thumb would, and only
 * surface errors that are not the collision.
 */
export async function gotoSettled(page: Page, url: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await page.goto(url);
      return;
    } catch (error) {
      const collision =
        /interrupted by another navigation|NS_BINDING_ABORTED|frame was detached/i.test(
          String(error),
        );
      if (!collision || attempt >= 2) throw error;
    }
  }
}
