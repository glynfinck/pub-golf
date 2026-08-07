import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { signInAs } from "./auth";
import { clickSettled, gotoSettled } from "./nav";

/**
 * The multiplayer suite: more phones than round-flow's pair, all live on the
 * same round at once. What round-flow proves for two browsers, these prove
 * at table scale — the stampede join, four thumbs scoring the same hole
 * together, ties, the zero-swig substitute, and a latecomer walking into a
 * round already under way.
 */

/** Join a round as a fresh anonymous guest phone. */
async function joinAsGuest(
  browser: Browser,
  code: string,
  name: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/join?code=${code}`);
  await page.getByLabel(/name on the card/i).fill(name);
  await page.getByRole("button", { name: /join the round/i }).click();
  await page.waitForURL(new RegExp(`/round/${code}`));
  return { context, page };
}

/** Tap +1 SWIG `count` times on one phone. */
async function drink(page: Page, count: number) {
  for (let sip = 0; sip < count; sip += 1) {
    await page.getByTestId("swig-plus").click();
  }
  if (count > 0) {
    await expect(page.getByTestId("swig-count")).toHaveText(String(count));
  }
}

test("a foursome: stampede join, four thumbs on one hole, ties and the substitute", async ({
  browser,
}) => {
  // Four phones, a hand-built course and a full round: on a cold dev server
  // the route compiles alone eat most of the default budget.
  test.setTimeout(150_000);
  const stamp = Date.now();

  // ---- The host plots a two-pub course: short enough to play to the 19th ----
  const hostContext = await browser.newContext();
  await signInAs(hostContext, {
    email: `foursome-${stamp}@e2e.local`,
    name: "Glyn",
  });
  const host = await hostContext.newPage();

  await host.goto("/courses/new");
  await host.getByLabel(/course name/i).fill(`Foursome Crawl ${stamp}`);
  await host.getByLabel(/add a pub by name/i).fill("The First Leg");
  await host.getByRole("button", { name: /add the named pub/i }).click();
  await host.getByLabel(/add a pub by name/i).fill("The Last Orders");
  await host.getByRole("button", { name: /add the named pub/i }).click();
  await host.getByRole("button", { name: /save the course · 2 holes/i }).click();
  await host.waitForURL(/\/courses$/);

  await host.goto("/new");
  await host.getByLabel(/round name/i).fill(`Foursome Open ${stamp}`);
  await host
    .getByRole("button", { name: new RegExp(`Foursome Crawl ${stamp}`) })
    .click();
  await host
    .getByRole("button", { name: /create round · 2 holes on foursome crawl/i })
    .click();
  await host.waitForURL(/\/round\/[A-Z2-9]{6}$/);
  const code = host.url().split("/").pop()!;

  // ---- Three guests join on the same code ----
  // One at a time: the true stampede (concurrent join_round) is proven at
  // the db tier, where it belongs. Spinning three WebKit contexts through
  // sign-in simultaneously only ever raced the test host's CPU.
  const guests = [];
  for (const name of ["Ana", "Bram", "Cleo"]) {
    guests.push(await joinAsGuest(browser, code, name));
  }
  const [ana, bram, cleo] = guests.map((guest) => guest.page);

  // Every seat lands on the host's guest list over realtime, no reload.
  for (const name of ["Ana", "Bram", "Cleo"]) {
    await expect(
      host.getByTestId("lobby-players").getByText(name),
    ).toBeVisible();
  }
  // And every guest phone's own socket must be live before the tee-off
  // broadcast has to find it — READY is presence-driven, so a visible badge
  // is the subscribe signal.
  for (const page of [ana, bram, cleo]) {
    await expect(page.getByText("READY").first()).toBeVisible();
  }

  // ---- Tee off: all four phones go live together ----
  await clickSettled(host, "tee-off");
  await Promise.all(
    [host, ana, bram, cleo].map((page) =>
      page.waitForURL(new RegExp(`/round/${code}/play`)),
    ),
  );
  await expect(host.getByTestId("hole-venue")).toHaveText("The First Leg");

  // Presence: four phones on the tee, and every one of them counted.
  await expect(host.getByText("4 OF 4 ON THIS HOLE")).toBeVisible();

  // ---- Hole 1 (par 4): four thumbs at once. Cleo drinks nothing ----
  await Promise.all([drink(host, 2), drink(ana, 2), drink(bram, 3)]);

  // The tie is live on the ribbon: Glyn and Ana level at the top.
  await expect(host.getByTestId("position-ribbon")).toContainText(
    "1st on the card",
  );
  await expect(host.getByTestId("position-ribbon")).toContainText(
    "level with Ana",
  );

  // And the whole card syncs to the quietest phone at the table.
  await cleo.getByTestId("position-ribbon").click();
  await expect(cleo.getByTestId("standings").getByText("Bram")).toBeVisible();

  // ---- The caddyless call: the host holes out, every phone walks ----
  await clickSettled(host, "hole-out");
  await Promise.all(
    [host, ana, bram, cleo].map((page) =>
      expect(page.getByTestId("walking-view")).toBeVisible(),
    ),
  );

  // The marker's card already knows what Cleo's silence will cost: the
  // substitute, never a free under-par hole. Scoped to Cleo's own row — a
  // slow write from another phone may leave a second card reading the same
  // line for a moment, and that phone's swigs are not this assertion's
  // business.
  await gotoSettled(host, `/round/${code}/card?hole=1`);
  await expect(
    host
      .getByRole("button", { name: /open cleo's card/i })
      .getByText("no swigs — scores the substitute"),
  ).toBeVisible();
  await gotoSettled(host, `/round/${code}/play`);

  // ---- Hole 2: tee up, quick drinks, and the card files ----
  await clickSettled(host, "tee-up");
  await Promise.all(
    [host, ana, bram, cleo].map((page) =>
      expect(page.getByTestId("hole-venue")).toHaveText("The Last Orders"),
    ),
  );
  await Promise.all([
    drink(host, 1),
    drink(ana, 2),
    drink(bram, 1),
    drink(cleo, 1),
  ]);

  await clickSettled(host, "hole-out");
  await Promise.all(
    [host, ana, bram, cleo].map((page) =>
      page.waitForURL(new RegExp(`/round/${code}/results`)),
    ),
  );

  // ---- The 19th hole, four ways ----
  // Glyn 3 takes it; Ana and Bram tie on 4; Cleo's blank hole scored the
  // par-4 substitute, so one real swig still finishes last on 5 — silence
  // never buys a cheap round.
  //
  // The finishing ORDER is the assertion, not decoration. Every phone here
  // taps its last swig and the caddy calls the hole inside the play
  // screen's 400ms debounce, so this is the one test that proves a late
  // write still lands: when the hole-window guard refused it, Ana and Bram
  // each took a substitute for a hole they had drunk (2+2 read as 6, 3+1
  // as 5) and the forfeit moved to the wrong player. Only the host escaped
  // it, being an official and exempt from the guard.
  await expect(host.getByTestId("winner")).toContainText("Glyn");
  for (const name of ["Glyn", "Ana", "Bram", "Cleo"]) {
    await expect(
      host.getByTestId("final-standings").getByText(name),
    ).toBeVisible();
  }
  await expect(host.getByText(/Cleo wears/)).toBeVisible();

  await hostContext.close();
  for (const guest of guests) await guest.context.close();
});

test("a latecomer joins a round already under way and lands on the live hole", async ({
  browser,
}) => {
  const stamp = Date.now();

  // ---- A pair tees off without the third ----
  const hostContext = await browser.newContext();
  await signInAs(hostContext, {
    email: `late-${stamp}@e2e.local`,
    name: "Glyn",
  });
  const host = await hostContext.newPage();
  await host.goto("/new");
  await host.getByLabel(/round name/i).fill(`Latecomer Cup ${stamp}`);
  await host.getByRole("button", { name: /create round/i }).click();
  await host.waitForURL(/\/round\/[A-Z2-9]{6}$/);
  const code = host.url().split("/").pop()!;

  const ana = await joinAsGuest(browser, code, "Ana");
  // Wait for Ana's OWN socket, not the host's view of her: the READY badge
  // is presence-driven, so it proves her phone is subscribed before the
  // tee-off broadcast has to find it. (Host-sees-guest realtime is proven
  // by the foursome and round-flow specs; a single join right after page
  // mount can race the host's subscribe handshake, and that race is not
  // what this test is about.)
  await expect(ana.page.getByText("READY", { exact: true })).toBeVisible();

  await clickSettled(host, "tee-off");
  await host.waitForURL(new RegExp(`/round/${code}/play`));
  await drink(host, 2);

  // ---- Lena arrives at pub one with the round already live ----
  // join_round accepts a live round, and the round page routes a member
  // straight to play — no lobby purgatory for the late arrival.
  const lena = await joinAsGuest(browser, code, "Lena");
  await lena.page.waitForURL(new RegExp(`/round/${code}/play`));
  await expect(lena.page.getByTestId("hole-venue")).toHaveText("Cat & Mutton");

  // The card Lena walked in on is already filled in: the host's swigs from
  // before the join are on the standings.
  await lena.page.getByTestId("position-ribbon").click();
  await expect(
    lena.page.getByTestId("standings").getByText("Glyn"),
  ).toBeVisible();

  // Presence counts the new phone: three seats, three on the hole.
  await expect(host.getByText("3 OF 3 ON THIS HOLE")).toBeVisible();

  // ---- The whole table moves together, latecomer included ----
  await clickSettled(host, "hole-out");
  await Promise.all(
    [host, ana.page, lena.page].map((page) =>
      expect(page.getByTestId("walking-view")).toBeVisible(),
    ),
  );

  await hostContext.close();
  await ana.context.close();
  await lena.context.close();
});
