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

  // ---- The leader dots run along the line the standing sits on ----
  // The dots are painted at the bottom of the leader's box, which rides the
  // baseline, so that edge and the HOST badge's baseline agree within a few
  // pixels. Centring the dots in a row a stepper had made tall put them
  // roughly ten pixels adrift.
  const lobby = page.getByTestId("lobby-players");
  const leaderBox = await lobby.locator("span.leader").first().boundingBox();
  const hostBox = await lobby.getByText("HOST").boundingBox();
  expect(leaderBox).not.toBeNull();
  expect(hostBox).not.toBeNull();
  expect(
    Math.abs(
      leaderBox!.y + leaderBox!.height - (hostBox!.y + hostBox!.height),
    ),
  ).toBeLessThanOrEqual(4);

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
