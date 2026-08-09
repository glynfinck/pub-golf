import { test, expect, type Page } from "@playwright/test";

import { signInAs } from "./auth";
import { clickSettled, expectSettled, gotoSettled } from "./nav";

/** Walk the group to the next tee: hole-out enters the walking phase,
 * tee-up re-arms the timer and puts every phone back on live play. */
async function holeOutAndTeeUp(caddy: Page, expectVenue?: string | RegExp) {
  await clickSettled(caddy, "hole-out");
  await expectSettled(caddy, "walking-view");
  await clickSettled(caddy, "tee-up");
  if (expectVenue) {
    await expect(caddy.getByTestId("hole-venue")).toHaveText(expectVenue);
  }
}

test("a full round: create, join, caddy controls, live scores, results", async ({
  browser,
}) => {
  const stamp = Date.now();
  const hostEmail = `host-${stamp}@e2e.local`;

  // ---- Host signs in and creates the round ----
  const hostContext = await browser.newContext();
  await signInAs(hostContext, { email: hostEmail, name: "Glyn" });
  const host = await hostContext.newPage();
  await host.goto("/");

  await host.getByRole("link", { name: /new round/i }).click();
  await host.getByLabel(/round name/i).fill(`E2E Invitational ${stamp}`);
  // Play this one with handicaps and a mulligan each, so the lobby
  // stepper and the mulligan button are both on the card. Both live in the
  // House rules section, which reads closed until opened.
  await host.getByRole("button", { name: /house rules/i }).click();
  await host.getByLabel(/player handicaps/i).click();
  await host.getByRole("button", { name: /more mulligans/i }).click();
  await host.getByRole("button", { name: /create round/i }).click();

  // The lobby URL carries the DB-generated unique code — the route key.
  await host.waitForURL(/\/round\/[A-Z2-9]{6}$/);
  const roundCode = host.url().split("/").pop()!;
  expect(roundCode).toMatch(/^[A-Z2-9]{6}$/);
  expect(roundCode).not.toMatch(/[01OI]/);

  // ---- Guest joins by code, no account ----
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(`/join?code=${roundCode}`);
  await expect(guest.getByText(`E2E Invitational ${stamp}`)).toBeVisible();
  await guest.getByLabel(/name on the card/i).fill("Jamie");
  await guest.getByRole("button", { name: /join the round/i }).click();
  await guest.waitForURL(new RegExp(`/round/${roundCode}$`));

  // Realtime presence: the host sees Jamie arrive without reloading.
  await expect(
    host.getByTestId("lobby-players").getByText("Jamie"),
  ).toBeVisible();

  // ---- Host gives Jamie two shots before anyone tees off ----
  // Only officials may adjust a card, and the controls live behind the
  // row: tapping Jamie's line opens the adjust sheet. Jamie just landed
  // over realtime, so the count and the tap retry as one block.
  await expect(async () => {
    const jamieRow = host
      .getByTestId("lobby-players")
      .getByRole("button", { name: /jamie/i });
    await expect(jamieRow).toHaveCount(1);
    await jamieRow.click({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await host.getByRole("button", { name: /raise Jamie's handicap/i }).click();
  await host.getByRole("button", { name: /raise Jamie's handicap/i }).click();
  // Jamie's phone prints the figure on the line, no reload.
  await expect(
    guest.getByTestId("lobby-players").getByText("OFF 2"),
  ).toBeVisible();

  // ---- Host hands Jamie the caddy's card — same sheet ----
  // The caddy carries no card of their own, so the figure gives way to
  // the standing on Jamie's line. The handicap raises above each re-render
  // this sheet, and a click that lands on the node being swapped out fires
  // no handler — Playwright saw it land, React never heard it, and the
  // guest's lobby waited out its budget for a CADDY nobody made. The chip
  // is a toggle, so the retry must read before it taps: aria-pressed is
  // the commit's own receipt, and only an unpressed chip gets the click.
  const caddyChip = host.getByRole("button", { name: /caddy · stays sober/i });
  await expect(async () => {
    if ((await caddyChip.getAttribute("aria-pressed")) !== "true") {
      await caddyChip.click({ timeout: 2_000 });
    }
    await expect(caddyChip).toHaveAttribute("aria-pressed", "true", {
      timeout: 1_000,
    });
  }).toPass({ timeout: 15_000 });
  await expect(
    guest.getByTestId("lobby-players").getByText("CADDY"),
  ).toBeVisible();
  await host.getByRole("button", { name: /^done$/i }).click();

  // ---- The caddy (not the host) tees off — officials share control ----
  await clickSettled(guest, "tee-off");
  await guest.waitForURL(new RegExp(`/round/${roundCode}/play`));
  await host.waitForURL(new RegExp(`/round/${roundCode}/play`));
  await expect(host.getByTestId("hole-venue")).toHaveText("Cat & Mutton");

  // ---- Host drinks: swigs sync to the caddy's standings ----
  for (let sip = 0; sip < 3; sip += 1) {
    await host.getByTestId("swig-plus").click();
  }
  await expect(host.getByTestId("swig-count")).toHaveText("3");
  // Standings live behind the position ribbon — one tap expands the card.
  await guest.getByTestId("position-ribbon").click();
  await expect(
    guest.getByTestId("standings").getByText("Glyn"),
  ).toBeVisible();

  // ---- The masthead: rules one tap away, the way out beside them ----
  // This round was created with handicaps and a mulligan, so the
  // sheet must read both back; the exit is a plain link to the clubhouse.
  await expect(host.getByTestId("round-exit")).toHaveAttribute("href", "/");
  await host.getByTestId("round-help").click();
  await expect(host.getByTestId("rules-sheet")).toContainText("Mulligans");
  await expect(host.getByTestId("rules-sheet")).toContainText("net scoring");
  await host.keyboard.press("Escape");
  await expect(host.getByTestId("rules-sheet")).toBeHidden();

  // ---- Penalties: open the sheet, call one, then undo the mis-tap ----
  await host.getByRole("button", { name: /penalties/i }).click();
  await host.getByRole("button", { name: /call spill \+1/i }).click();
  await expect(host.getByRole("button", { name: /undo spill \+1/i })).toBeEnabled();
  await host.getByRole("button", { name: /undo spill \+1/i }).click();
  await expect(
    host.getByRole("button", { name: /undo spill \+1/i }),
  ).toBeDisabled();
  await host.keyboard.press("Escape");
  await expect(
    host.getByRole("button", { name: /call spill \+1/i }),
  ).toBeHidden();

  // ---- Marker's card: the caddy corrects the host's score on hole 1 ----
  await gotoSettled(guest, `/round/${roundCode}/card`);
  await guest
    .getByRole("button", { name: /more swigs for Glyn on hole 1/i })
    .click();
  await expect(host.getByTestId("swig-count")).toHaveText("4");

  // The caddy calls a penalty on the host from the player sheet, then
  // thinks better of it. Both directions are attributed.
  await guest.getByRole("button", { name: /open Glyn's card/i }).click();
  await guest.getByRole("button", { name: /call spill \+1 on Glyn/i }).click();
  await expect(
    guest.getByRole("button", { name: /retract spill \+1 from Glyn/i }),
  ).toBeEnabled();
  await guest
    .getByRole("button", { name: /retract spill \+1 from Glyn/i })
    .click();
  await expect(
    guest.getByRole("button", { name: /retract spill \+1 from Glyn/i }),
  ).toBeDisabled();
  await guest.keyboard.press("Escape");
  await gotoSettled(guest, `/round/${roundCode}/play`);

  // ---- Caddy calls the hole; the whole group walks, then tees up ----
  await clickSettled(guest, "hole-out");
  // Both phones enter the walking phase together, pointed at the next pub.
  await expect(guest.getByTestId("walking-view")).toBeVisible();
  await expect(host.getByTestId("walking-view")).toBeVisible();
  // The walk carries the whole card: the same rule lines the lobby printed.
  await expect(guest.getByTestId("walking-view")).toContainText("Mulligans");
  await expect(guest.getByTestId("walking-next-venue")).toHaveText(
    "Pub on the Park",
  );
  await clickSettled(guest, "tee-up");
  await expect(guest.getByTestId("hole-venue")).toHaveText("Pub on the Park");
  await expect(host.getByTestId("hole-venue")).toHaveText("Pub on the Park");

  // ---- Mulligan: a bad hole gets wiped for a half pint ----
  for (let sip = 0; sip < 5; sip += 1) {
    await host.getByTestId("swig-plus").click();
  }
  await expect(host.getByTestId("swig-count")).toHaveText("5");
  await clickSettled(host, "mulligan");
  await clickSettled(host, "take-mulligan");
  // The hole is back to nothing, and that was the only one on the card.
  await expect(host.getByTestId("swig-count")).toHaveText("0");
  await expect(host.getByTestId("mulligan")).toBeDisabled();

  // The table finds out: the caddy's standings carry the permanent ↺ ×1
  // mark against the host's name.
  await guest.getByTestId("position-ribbon").click();
  await expect(guest.getByTestId("standings")).toContainText("×1");
  await guest.getByTestId("position-ribbon").click();

  // And the rule chips under the hole header read the round at a glance —
  // this one plays handicapped, so "net" is on the line.
  await expect(host.getByTestId("rule-chips")).toContainText("net");

  // ---- Local rules: on their own hole and nowhere else ----
  // The Invitational's third hole carries one; the first carries none. Roam
  // reviews both without moving the round off hole 2.
  await gotoSettled(guest, `/round/${roundCode}/card?hole=3`);
  await guest.getByRole("button", { name: /open Glyn's card/i }).click();
  await expect(
    guest.getByRole("button", {
      name: /call drinking before the pass is complete \+2 on Glyn/i,
    }),
  ).toBeVisible();
  await guest.keyboard.press("Escape");

  await gotoSettled(guest, `/round/${roundCode}/card?hole=1`);
  await guest.getByRole("button", { name: /open Glyn's card/i }).click();
  await expect(
    guest.getByRole("button", {
      name: /call drinking before the pass is complete \+2 on Glyn/i,
    }),
  ).toBeHidden();
  await expect(
    guest.getByRole("button", { name: /call spill \+1 on Glyn/i }),
  ).toBeVisible();
  await guest.keyboard.press("Escape");

  // ---- Marker's roam: review hole 1 without moving the round ----
  await gotoSettled(guest, `/round/${roundCode}/card?hole=1`);
  await expectSettled(guest, "roaming-banner");
  // The caddy edits the record; the round stays on hole 2 for everyone.
  await guest
    .getByRole("button", { name: /fewer swigs for Glyn on hole 1/i })
    .click();
  await expect(host.getByTestId("hole-venue")).toHaveText("Pub on the Park");

  // ---- The only rewind: reopen hole 1 for everyone ----
  await clickSettled(guest, "reopen-hole");
  await guest.waitForURL(new RegExp(`/round/${roundCode}/play`));
  await expect(guest.getByTestId("hole-venue")).toHaveText("Cat & Mutton");
  await expect(host.getByTestId("hole-venue")).toHaveText("Cat & Mutton");

  // Restore the host's corrected score before playing out.
  await gotoSettled(guest, `/round/${roundCode}/card`);
  await guest
    .getByRole("button", { name: /more swigs for Glyn on hole 1/i })
    .click();
  await expect(host.getByTestId("swig-count")).toHaveText("4");
  await gotoSettled(guest, `/round/${roundCode}/play`);

  // ---- Play the course out: walk, tee up, drink, repeat ----
  for (let hole = 1; hole <= 9; hole += 1) {
    if (hole === 9) {
      await clickSettled(guest, "hole-out");
    } else {
      await holeOutAndTeeUp(guest);
      await expect(guest.getByTestId("hole-venue")).not.toHaveText("", {
        timeout: 10_000,
      });
    }
  }

  // ---- The 19th hole: both phones land on results together ----
  await guest.waitForURL(new RegExp(`/round/${roundCode}/results`));
  await host.waitForURL(new RegExp(`/round/${roundCode}/results`));
  await expect(host.getByTestId("winner")).toBeVisible();
  await expect(host.getByTestId("final-standings")).toContainText("Jamie");
  // Handicapped round: the card is settled on net, with gross still shown and
  // Jamie's two shots on the line beside their name.
  await expect(host.getByTestId("winner")).toContainText(/net/i);
  await expect(host.getByTestId("final-standings")).toContainText("hcp 2");

  // ---- Caddy reopens the last hole, then files the card again ----
  await clickSettled(guest, "reopen-round");
  await guest.waitForURL(new RegExp(`/round/${roundCode}/play`));
  await host.waitForURL(new RegExp(`/round/${roundCode}/play`));
  await clickSettled(guest, "hole-out");
  await guest.waitForURL(new RegExp(`/round/${roundCode}/results`));

  // ---- The guest claims their card: anonymous → Google-linked ----
  // The consent screen belongs to Google and cannot be driven here, so assert
  // the handoff instead: the button must send this anonymous session to
  // Supabase's identity-linking endpoint for google, returning to our own
  // callback. Intercepting it also keeps the run off the network.
  let authorizeUrl: string | null = null;
  await guest.route("**/user/identities/authorize**", async (route) => {
    authorizeUrl = route.request().url();
    await route.fulfill({ status: 204, body: "" });
  });

  await expect(guest.getByTestId("claim-card")).toBeVisible();
  await guest.getByTestId("claim-card").click();
  await expect.poll(() => authorizeUrl).toContain("provider=google");
  expect(decodeURIComponent(authorizeUrl!)).toContain("/auth/callback?next=");

  await hostContext.close();
  await guestContext.close();
});
