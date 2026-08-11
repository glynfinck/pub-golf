import { test, expect } from "@playwright/test";

import { signInAs } from "./auth";
import { clickSettled } from "./nav";

/**
 * The lobby's guest list, measured rather than eyeballed.
 *
 * The row's contract since the adjust-sheet redesign: one line per guest
 * at one height, always. A row must never grow because a rule or a role
 * added something to it — that regression is exactly how the old layout
 * drifted, with steppers landing at three different depths. The controls
 * that used to stretch rows (the caddy button, the handicap stepper) live
 * in the sheet behind the row now, so the geometry pinned here is: the
 * figure and the standing ride the leader's line; adjusting a handicap in
 * the sheet changes the row's text but never its height; and the sheet's
 * stepper keeps its + inside its own frame — the escape-through-the-border
 * bug this file was born to catch.
 */
test("the lobby row holds one height, with the controls in the sheet", async ({
  page,
}) => {
  const stamp = Date.now();
  await signInAs(page.context(), {
    email: `lobby-${stamp}@e2e.local`,
    name: "Wren",
  });

  await page.goto("/new");
  await page.getByLabel(/round name/i).fill(`Lobby Geometry ${stamp}`);
  await page.getByRole("button", { name: /house rules/i }).click();
  await page.getByLabel(/player handicaps/i).click();
  await page.getByRole("button", { name: /create round/i }).click();
  await page.waitForURL(/\/round\/[A-Z2-9]{6}$/);

  // ---- One line: the figure and the standing ride the leader's line ----
  // Handicaps are on and the host plays off zero, so the row prints
  // SCRATCH — the figure is a fixture of every playing row, not an
  // occasional visitor that changes the layout when it arrives.
  const lobby = page.getByTestId("lobby-players");
  const row = lobby.getByTestId("lobby-player-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByText("SCRATCH")).toBeVisible();

  const leaderBox = await lobby.locator("span.leader").first().boundingBox();
  const hostBox = await lobby.getByText("HOST").boundingBox();
  expect(leaderBox).not.toBeNull();
  expect(hostBox).not.toBeNull();
  const overlap =
    Math.min(leaderBox!.y + leaderBox!.height, hostBox!.y + hostBox!.height) -
    Math.max(leaderBox!.y, hostBox!.y);
  expect(overlap).toBeGreaterThan(0);
  const before = await row.boundingBox();
  expect(before).not.toBeNull();

  // ---- The stepper lives in the sheet, its + inside its frame ----
  await clickSettled(page, "lobby-player-row");
  const raise = page.getByRole("button", { name: /raise wren's handicap/i });
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

  // ---- Two shots on: the row's text changes, its height doesn't ----
  await raise.click();
  await raise.click();
  await page.getByRole("button", { name: /^done$/i }).click();
  await expect(page.getByTestId("lobby-player-sheet")).toBeHidden();
  await expect(row.getByText("OFF 2")).toBeVisible();
  const after = await row.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(0.5);

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
