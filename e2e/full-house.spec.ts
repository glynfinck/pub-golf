import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { signInAs } from "./auth";
import { clickSettled, expectSettled, gotoSettled } from "./nav";
import { leaveSeats, standOnTheHole, tableDrinks, takeSeats } from "./seats";
import type { Seat } from "./seats";

/**
 * Twenty on one card, and three of them watching.
 *
 * `foursome` plays four phones, which is a table. This plays twenty, which is
 * a stag do — and it asks a narrower question than "does it work": does a
 * live page stay honest while seventeen other sessions write underneath it?
 * Every score landing on this round fires a postgres_changes event at every
 * subscribed phone, so at twenty seats the pages under test are re-rendering
 * against a stream, not an occasional nudge.
 *
 * Three real browser contexts, seventeen headless seats. The seventeen are
 * real sessions through the real join door on real sockets (see `seats.ts`);
 * what they skip is React, which is the part being measured on the other
 * three. Twenty contexts per engine across a three-engine matrix would mostly
 * measure the CPU of whatever is running the suite — a lesson `foursome`
 * already paid for with its stampede.
 */

const HEADLESS_SEATS = 17;
/** Three real pages + seventeen headless = the full house. */
const TABLE = HEADLESS_SEATS + 3;

/** The seventeen, named so a failure reads like a person. */
const CROWD = [
  "Dot",
  "Esme",
  "Fitz",
  "Gus",
  "Hero",
  "Ida",
  "Jools",
  "Kit",
  "Lena",
  "Mo",
  "Nev",
  "Otto",
  "Pip",
  "Quin",
  "Rue",
  "Sol",
  "Tam",
];

/** Join a round as a fresh anonymous guest phone. */
async function joinAsGuest(
  browser: Browser,
  code: string,
  name: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/join?code=${code}`);
  // The round preview is fetched after mount, so its arrival is the only
  // honest proof this page has hydrated — and the join form submits through
  // preventDefault, so a click landing a moment early does nothing at all.
  await expect(page.getByText(/in the lobby|already live/i)).toBeVisible();
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

test("a full house: twenty seats, three phones watching, one card", async ({
  browser,
}) => {
  // Twenty sessions, a hand-built course and a full round played to the
  // 19th. Sized the way foursome's budget is: on a cold dev server the route
  // compiles alone eat minutes — a cost CI never pays, since it serves the
  // build the job already made.
  test.setTimeout(300_000);
  const stamp = Date.now();
  let crowd: Seat[] = [];

  const hostContext = await browser.newContext();
  const guestContexts: BrowserContext[] = [];

  try {
    // ---- The host plots two pubs: short enough to play to the 19th ----
    await signInAs(hostContext, {
      email: `fullhouse-${stamp}@e2e.local`,
      name: "Glyn",
    });
    const host = await hostContext.newPage();

    await host.goto("/courses/new");
    // The builder is a controlled form: a fill that lands before React
    // hydrates is wiped when the inputs are taken over, and the wipe is
    // silent — the name empties, the save button below stays disabled for
    // want of it, and the click waits out the whole budget. The Add button
    // is the one control that answers back (it enables only when live React
    // sees text in its field), so fill and listen for the answer as one
    // retried block. WebKit hydrates slowest and found this, exactly the
    // way it found the join form's version of the same race.
    const pubField = host.getByLabel(/add a pub by name/i);
    const addPub = host.getByRole("button", { name: /add the named pub/i });
    await expect(async () => {
      await pubField.fill("The First Leg");
      await expect(addPub).toBeEnabled({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });

    await addPub.click();
    await pubField.fill("The Last Orders");
    await addPub.click();
    // The save button answers for the whole form: its label counts the
    // holes and it enables only once live React also holds a course name.
    // CI has seen the count reach 2 while the name never made it out of
    // the DOM, so the name fill and the enablement check retry as one
    // block — the click stays outside it, because a click that lands must
    // not repeat.
    const saveCourse = host.getByRole("button", {
      name: /save the course · 2 holes/i,
    });
    await expect(async () => {
      await host
        .getByLabel(/course name/i)
        .fill(`Full House Crawl ${stamp}`);
      await expect(saveCourse).toBeEnabled({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await saveCourse.click();
    await host.waitForURL(/\/courses$/);

    await host.goto("/new");
    // Same controlled-form rule as the builder: pick the course first and
    // let the create button's label answer — it only names the course once
    // live React has registered the selection — then fill the round name on
    // a page that has proven itself hydrated.
    const createRound = host.getByRole("button", {
      name: /create round · 2 holes on full house crawl/i,
    });
    await expect(async () => {
      await host
        .getByRole("button", { name: new RegExp(`Full House Crawl ${stamp}`) })
        .click();
      await expect(createRound).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await host.getByLabel(/round name/i).fill(`Full House Open ${stamp}`);
    await createRound.click();
    await host.waitForURL(/\/round\/[A-Z2-9]{6}$/);
    const code = host.url().split("/").pop()!;

    // ---- Seventeen phones on the group chat, then two walking in ----
    // The crowd seats first, while the host's is the only live page: the
    // seventeen joins are seventeen realtime events, and every one asks the
    // pages that can see the round to re-render. Three browser pages
    // absorbing that on one dev server is how WebKit spent a whole budget
    // painting — and it is also not the real order of things: the code hits
    // the group chat before anybody's phone is out on the table.
    crowd = await takeSeats(code, CROWD);
    const ana = await joinAsGuest(browser, code, "Ana");
    const bram = await joinAsGuest(browser, code, "Bram");
    guestContexts.push(ana.context, bram.context);

    // Every seat lands on the host's lobby over realtime, no reload. The
    // count is the assertion: at twenty seats a lobby that dropped one to a
    // missed event still looks perfectly convincing. Short attempts on a
    // long runway — the count itself must land exactly, the runway is for
    // dev mode re-rendering nineteen times on the slowest engine.
    await expect(async () => {
      const rows = host
        .getByTestId("lobby-players")
        .getByTestId("lobby-player-row");
      await expect(rows).toHaveCount(TABLE, { timeout: 2_000 });
    }).toPass({ timeout: 90_000 });
    for (const name of ["Ana", "Bram", "Rue", "Tam"]) {
      await expect(
        host.getByTestId("lobby-players").getByText(name, { exact: true }),
      ).toBeVisible();
    }

    // ---- Tee off: three phones go live, seventeen sockets come to the hole
    await clickSettled(host, "tee-off");
    await Promise.all(
      [host, ana.page, bram.page].map((page) =>
        page.waitForURL(new RegExp(`/round/${code}/play`)),
      ),
    );
    await expect(host.getByTestId("hole-venue")).toHaveText("The First Leg");

    await Promise.all(crowd.map((seat) => standOnTheHole(seat)));

    // Presence at full house: everybody counted, nobody counted twice.
    await expect(host.getByText(`${TABLE} OF ${TABLE} ON THIS HOLE`)).toBeVisible(
      { timeout: 30_000 },
    );

    // ---- Hole 1 (par 4): three thumbs and seventeen sessions, together ----
    // The storm and the taps overlap on purpose: this is the moment every
    // live page is re-rendering off a stream of other people's writes while
    // its own user is still tapping.
    await Promise.all([
      drink(host, 2),
      drink(ana.page, 3),
      drink(bram.page, 5),
      // Rue drinks least of the crowd, so the leaderboard has a known shape
      // that no amount of realtime churn is allowed to blur.
      tableDrinks(crowd, 1, (seat) => (seat.name === "Rue" ? 1 : 4)),
    ]);

    // The card the quietest phone can see is the whole table's card — and it
    // is right. Counting the rows first: a standings list that lost a player
    // to a coalesced refresh would still show plausible names.
    await ana.page.getByTestId("position-ribbon").click();
    await expect(async () => {
      const rows = ana.page.getByTestId("standings").locator("> div");
      await expect(rows).toHaveCount(TABLE, { timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await expect(
      ana.page.getByTestId("standings").getByText("Rue", { exact: true }),
    ).toBeVisible();

    // Rue is alone at the top on 1 against a par 4, and the host's own page
    // agrees — two independent sockets, one card.
    await expectSettled(host, "position-ribbon", async (ribbon) => {
      await expect(ribbon).toContainText("behind Rue");
    });

    // ---- The host holes out: twenty seats walk together ----
    await clickSettled(host, "hole-out");
    await Promise.all(
      [host, ana.page, bram.page].map((page) =>
        expect(page.getByTestId("walking-view")).toBeVisible(),
      ),
    );

    // The marker's card carries all twenty, mid-walk.
    await gotoSettled(host, `/round/${code}/card?hole=1`);
    await expect(
      host.getByRole("button", { name: /open rue's card/i }),
    ).toBeVisible();
    await gotoSettled(host, `/round/${code}/play`);

    // ---- Hole 2: tee up, the table drinks again, the card files ----
    await clickSettled(host, "tee-up");
    await Promise.all(
      [host, ana.page, bram.page].map((page) =>
        expect(page.getByTestId("hole-venue")).toHaveText("The Last Orders"),
      ),
    );
    await Promise.all([
      drink(host, 1),
      drink(ana.page, 2),
      drink(bram.page, 2),
      tableDrinks(crowd, 2, (seat) => (seat.name === "Rue" ? 1 : 3)),
    ]);

    await clickSettled(host, "hole-out");
    await Promise.all(
      [host, ana.page, bram.page].map((page) =>
        page.waitForURL(new RegExp(`/round/${code}/results`)),
      ),
    );

    // ---- The 19th hole, twenty ways ----
    // Rue drank 1 and 1 against pars of 4 and 4: six under, and clear.
    await expect(host.getByTestId("winner")).toContainText("Rue");
    await expect(async () => {
      const rows = host.getByTestId("final-standings").locator("> div");
      await expect(rows).toHaveCount(TABLE, { timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    // No `exact` here: a final-standings row sets rank and name in one line
    // of type, so no element's text is exactly the bare name — substring
    // match, the same way `foursome` reads this table.
    for (const name of ["Glyn", "Ana", "Bram", "Rue", "Tam"]) {
      await expect(
        host.getByTestId("final-standings").getByText(name),
      ).toBeVisible();
    }
  } finally {
    leaveSeats(crowd);
    await hostContext.close();
    for (const context of guestContexts) await context.close();
  }
});
