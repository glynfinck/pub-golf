import { test, expect } from "@playwright/test";

import { signInAs } from "./auth";
import { clickSettled } from "./nav";

/**
 * The lobby's guest list, measured rather than eyeballed.
 *
 * Two geometry bugs lived here: the handicap stepper was given a width
 * below its own content's minimum, so the + escaped through the rounded
 * border; and the dot leader was centred in a row whose height a stepper
 * or a button could change, so the dots drifted off the line the name and
 * the standing sit on. Both are invisible to any assertion about text —
 * only bounding boxes catch them.
 */
test("the lobby row keeps its controls inside their frames, on the line", async ({
  page,
}) => {
  const stamp = Date.now();
  await signInAs(page.context(), {
    email: `lobby-${stamp}@e2e.local`,
    name: "Glyn",
  });

  await page.goto("/new");
  await page.getByLabel(/round name/i).fill(`Lobby Geometry ${stamp}`);
  await page.getByRole("button", { name: /house rules/i }).click();
  await page.getByLabel(/player handicaps/i).click();
  await page.getByRole("button", { name: /create round/i }).click();
  await page.waitForURL(/\/round\/[A-Z2-9]{6}$/);

  // ---- The stepper's + stays inside the stepper ----
  const raise = page.getByRole("button", { name: /raise glyn's handicap/i });
  await expect(raise).toBeVisible();
  const frame = raise.locator("xpath=..");
  const plusBox = await raise.boundingBox();
  const frameBox = await frame.boundingBox();
  expect(plusBox).not.toBeNull();
  expect(frameBox).not.toBeNull();
  // Half a pixel of tolerance: sub-pixel layout is fine, 16px of overflow
  // (a w-24 frame around 112px of content) is the bug.
  expect(plusBox!.x + plusBox!.width).toBeLessThanOrEqual(
    frameBox!.x + frameBox!.width + 0.5,
  );
  expect(plusBox!.x).toBeGreaterThanOrEqual(frameBox!.x - 0.5);

  // ---- The dots ride the name's line, above everything else in the row ----
  // Asserted structurally rather than by comparing box edges: the first cut
  // of this test compared the leader's bottom with the HOST badge's, which
  // is a difference of font metrics between 14px text and a 10px uppercase
  // badge — 4px on macOS, 5px on CI's Linux fonts, and a number that means
  // nothing either way. What the bug actually did was let a tall row drag
  // the dots down level with the handicap stepper, so that is what gets
  // pinned: the stepper hangs entirely beneath the line the dots run along.
  const lobby = page.getByTestId("lobby-players");
  const leaderBox = await lobby.locator("span.leader").first().boundingBox();
  expect(leaderBox).not.toBeNull();
  expect(leaderBox!.y + leaderBox!.height).toBeLessThanOrEqual(frameBox!.y);

  // And the standing shares that line rather than sitting on its own.
  const hostBox = await lobby.getByText("HOST").boundingBox();
  expect(hostBox).not.toBeNull();
  const overlap =
    Math.min(leaderBox!.y + leaderBox!.height, hostBox!.y + hostBox!.height) -
    Math.max(leaderBox!.y, hostBox!.y);
  expect(overlap).toBeGreaterThan(0);

  // ---- And the row still works ----
  await clickSettled(page, "tee-off");
  await page.waitForURL(/\/play$/);

  // ---- The caddy's three controls are one row of one geometry ----
  // "Hole out" used Button's compact size (h-8, rounded-lg) beside two
  // 44px rounded-xl siblings, so it sat visibly short and square.
  const marker = page.getByRole("link", { name: /marker's card/i });
  const holeOut = page.getByTestId("hole-out");
  const markerBox = await marker.boundingBox();
  const holeOutBox = await holeOut.boundingBox();
  expect(markerBox).not.toBeNull();
  expect(holeOutBox).not.toBeNull();
  expect(Math.abs(markerBox!.height - holeOutBox!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(markerBox!.y - holeOutBox!.y)).toBeLessThanOrEqual(1);
});
