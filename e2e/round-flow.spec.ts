import { test, expect, type Page } from "@playwright/test";

import { signInAs } from "./auth";

/** Walk the group to the next tee: hole-out enters the walking phase,
 * tee-up re-arms the timer and puts every phone back on live play. */
async function holeOutAndTeeUp(caddy: Page, expectVenue?: string | RegExp) {
  await caddy.getByTestId("hole-out").click();
  await expect(caddy.getByTestId("walking-view")).toBeVisible();
  await caddy.getByTestId("tee-up").click();
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

  // ---- Host hands Jamie the caddy's card ----
  await host.getByRole("button", { name: /^make caddy$/i }).click();
  await expect(
    guest.getByText(/caddy · stays sober, final word/i),
  ).toBeVisible();

  // ---- The caddy (not the host) tees off — officials share control ----
  await guest.getByTestId("tee-off").click();
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
  await guest.goto(`/round/${roundCode}/card`);
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
  await guest.goto(`/round/${roundCode}/play`);

  // ---- Caddy calls the hole; the whole group walks, then tees up ----
  await guest.getByTestId("hole-out").click();
  // Both phones enter the walking phase together, pointed at the next pub.
  await expect(guest.getByTestId("walking-view")).toBeVisible();
  await expect(host.getByTestId("walking-view")).toBeVisible();
  await expect(guest.getByTestId("walking-next-venue")).toHaveText(
    "Pub on the Park",
  );
  await guest.getByTestId("tee-up").click();
  await expect(guest.getByTestId("hole-venue")).toHaveText("Pub on the Park");
  await expect(host.getByTestId("hole-venue")).toHaveText("Pub on the Park");

  // ---- Marker's roam: review hole 1 without moving the round ----
  await guest.goto(`/round/${roundCode}/card?hole=1`);
  // .first(): mid-navigation the outgoing and incoming cards can both be in
  // the DOM for a frame, which tripped strict mode in CI.
  await expect(guest.getByTestId("roaming-banner").first()).toBeVisible();
  // The caddy edits the record; the round stays on hole 2 for everyone.
  await guest
    .getByRole("button", { name: /fewer swigs for Glyn on hole 1/i })
    .click();
  await expect(host.getByTestId("hole-venue")).toHaveText("Pub on the Park");

  // ---- The only rewind: reopen hole 1 for everyone ----
  await guest.getByTestId("reopen-hole").click();
  await guest.waitForURL(new RegExp(`/round/${roundCode}/play`));
  await expect(guest.getByTestId("hole-venue")).toHaveText("Cat & Mutton");
  await expect(host.getByTestId("hole-venue")).toHaveText("Cat & Mutton");

  // Restore the host's corrected score before playing out.
  await guest.goto(`/round/${roundCode}/card`);
  await guest
    .getByRole("button", { name: /more swigs for Glyn on hole 1/i })
    .click();
  await expect(host.getByTestId("swig-count")).toHaveText("4");
  await guest.goto(`/round/${roundCode}/play`);

  // ---- Play the course out: walk, tee up, drink, repeat ----
  for (let hole = 1; hole <= 9; hole += 1) {
    if (hole === 9) {
      await guest.getByTestId("hole-out").click();
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

  // ---- Caddy reopens the last hole, then files the card again ----
  await guest.getByTestId("reopen-round").click();
  await guest.waitForURL(new RegExp(`/round/${roundCode}/play`));
  await host.waitForURL(new RegExp(`/round/${roundCode}/play`));
  await guest.getByTestId("hole-out").click();
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
