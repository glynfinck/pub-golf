import { test, expect, type Page } from "@playwright/test";

import { signInAs } from "./auth";
import { expectSettled } from "./nav";

/**
 * Add a pub through the builder's by-name row.
 *
 * Three separate races meet on this one button, and CI found the second of
 * them on WebKit — a 90-second hang that passed on retry, which
 * `failOnFlakyTests` correctly calls a failure:
 *
 * 1. Hydration. A fill landing before React is live is silently wiped.
 * 2. The row clears itself. `addManual` calls setManualName(""), so a fill
 *    landing in the same beat as that re-render is wiped by it too — and the
 *    button then sits disabled, because it enables on text it never saw. It
 *    stays *briefly* clickable on the "Added" flash alone, which is why this
 *    only bites once the flash expires and why it looked like a stall.
 * 3. The flash changes the button's width, so a click aimed at it mid-swap
 *    is a click at a moving target.
 *
 * So: wait for the button back at rest, then retry the fill until React
 * itself holds the text — the input is controlled, so its DOM value *is*
 * React's state, and that is the only honest proof. The click stays outside
 * the retry, because a click that lands must never repeat.
 */
async function addPubByName(page: Page, name: string) {
  const field = page.getByLabel(/add a pub by name/i);
  const button = page.getByRole("button", { name: /add the named pub/i });

  await expect(button).toHaveText("Add");
  await expect(async () => {
    await field.fill(name);
    await expect(field).toHaveValue(name, { timeout: 1_000 });
    await expect(button).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await button.click();
}

test("build a course by hand, then play a round on it", async ({ page }) => {
  const stamp = Date.now();
  await signInAs(page.context(), {
    email: `builder-${stamp}@e2e.local`,
    name: "Glyn",
  });

  // ---- Plot a two-pub course by name (works with or without a key) ----
  await page.goto("/courses/new");
  // The builder hangs from the same masthead as every no-tab-bar screen,
  // and its way back is the course book. Count first: mid-navigation the
  // outgoing and incoming screens both hold a masthead for a moment.
  await expectSettled(page, "masthead-back", (back) =>
    expect(back).toHaveAttribute("href", "/courses"),
  );
  await addPubByName(page, "The Test Tavern");
  await addPubByName(page, "The Other Arms");

  // Dress hole 1: par up, a proper drink, a water hazard with a note.
  await page.getByRole("button", { name: /raise par on hole 1/i }).click();
  await page.getByLabel(/^the drink$/i).first().fill("Pint of the black stuff");
  await page.getByRole("button", { name: /^water$/i }).first().click();
  await page
    .getByLabel(/hazard note for hole 1/i)
    .fill("No toilet for the whole hole");

  // A local rule on hole 1 only — the hazard note says what the rule is, this
  // says what it costs.
  await page.getByRole("button", { name: /add a local rule/i }).first().click();
  await page
    .getByLabel(/local rule 1 on hole 1/i)
    .fill("Drinking with your right hand");
  await page
    .getByRole("button", {
      name: /raise the strokes on local rule 1 of hole 1/i,
    })
    .click();

  // The save button answers for the whole form: its label counts the holes
  // and it enables only once live React also holds a course name. CI has
  // seen the count reach 2 while the name never made it out of the DOM, so
  // the name fill and the enablement check retry as one block — the click
  // stays outside it, because a click that lands must not repeat.
  const saveCourse = page.getByRole("button", {
    name: /save the course · 2 holes/i,
  });
  await expect(async () => {
    await page.getByLabel(/course name/i).fill(`Two Pub Crawl ${stamp}`);
    await expect(saveCourse).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await saveCourse.click();
  await page.waitForURL(/\/courses$/);
  await expect(page.getByText(`Two Pub Crawl ${stamp}`)).toBeVisible();
  await expect(page.getByText("2 holes · par 9")).toBeVisible();

  // ---- The saved course appears in the round wizard and plays ----
  await page.goto("/new");
  // The wizard's masthead walks back to the clubhouse it was opened from.
  await expectSettled(page, "masthead-back", (back) =>
    expect(back).toHaveAttribute("href", "/"),
  );
  await page.getByLabel(/round name/i).fill(`Course Test ${stamp}`);
  await page
    .getByRole("button", { name: new RegExp(`Two Pub Crawl ${stamp}`) })
    .click();
  await page
    .getByRole("button", { name: /create round · 2 holes on two pub crawl/i })
    .click();
  await page.waitForURL(/\/round\/[A-Z2-9]{6}$/);
  await expect(page.getByText("2 holes")).toBeVisible();
  await expect(page.getByText("par 9")).toBeVisible();

  // Tee off alone and check the custom course carried its dressing.
  await page.getByTestId("tee-off").click();
  await page.waitForURL(/\/play$/);
  await expect(page.getByTestId("hole-venue")).toHaveText("The Test Tavern");
  await expect(page.getByText("Pint of the black stuff")).toBeVisible();
  await expect(page.getByText(/no toilet for the whole hole/i)).toBeVisible();

  // The local rule is on hole 1's sheet, under its own heading, alongside the
  // house shortcuts — and it followed the course into the round's snapshot.
  // Scoped to the sheet: the play screen behind it carries a presence line
  // reading "1 OF 1 ON THIS HOLE", which a loose text match also finds.
  const sheet = page.getByRole("dialog");
  await page.getByRole("button", { name: /penalties/i }).click();
  await expect(sheet.getByText("On this hole", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /call drinking with your right hand \+3/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /call spill \+1/i }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Hole 2 was never given one, so its sheet is the house list alone.
  await page.getByTestId("hole-out").click();
  await page.getByTestId("tee-up").click();
  await expect(page.getByTestId("hole-venue")).toHaveText("The Other Arms");
  await page.getByRole("button", { name: /penalties/i }).click();
  await expect(
    page.getByRole("button", {
      name: /call drinking with your right hand \+3/i,
    }),
  ).toBeHidden();
  await expect(sheet.getByText("On this hole", { exact: true })).toBeHidden();
});

test("edit the running order without tearing up the card", async ({ page }) => {
  const stamp = Date.now();
  await signInAs(page.context(), {
    email: `reorder-${stamp}@e2e.local`,
    name: "Glyn",
  });

  await page.goto("/courses/new");

  await addPubByName(page, "Alpha Arms");
  await addPubByName(page, "Beta Bar");
  await addPubByName(page, "Gamma Tavern");

  const holeNames = page.getByTestId("draft-hole-name");
  await expect(holeNames).toHaveText(["Alpha Arms", "Beta Bar", "Gamma Tavern"]);

  // Dress hole 1, so the swap below has something to prove it kept.
  await page.getByRole("button", { name: /raise par on hole 1/i }).click();
  await page.getByLabel(/^the drink$/i).first().fill("Half of stout");

  // ---- Move: the last hole walks up the order, twice ----
  await page
    .getByRole("button", { name: /move gamma tavern to hole 2/i })
    .click();
  await expect(holeNames).toHaveText(["Alpha Arms", "Gamma Tavern", "Beta Bar"]);

  // ---- Replace: hole 1 changes pub and keeps its dressing ----
  await page
    .getByRole("button", { name: /manage hole 1 · alpha arms/i })
    .click();
  await page.getByTestId("change-pub").click();
  // The picker's own by-name row is a controlled input on a panel that has
  // only just mounted, so the fill retries until React holds it — same rule
  // as addPubByName, and the click stays outside the retry for the same one.
  const pickField = page.getByLabel(/or name the pub yourself/i);
  await expect(async () => {
    await pickField.fill("Delta Inn");
    await expect(pickField).toHaveValue("Delta Inn", { timeout: 1_000 });
    await expect(
      page.getByRole("button", { name: /choose the named pub/i }),
    ).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: /choose the named pub/i }).click();

  await expect(holeNames).toHaveText(["Delta Inn", "Gamma Tavern", "Beta Bar"]);
  // The pub changed; the par and the drink on that hole did not.
  await expect(page.getByLabel(/^the drink$/i).first()).toHaveValue(
    "Half of stout",
  );

  // ---- Insert: a pub lands between two others, not at the end ----
  await page
    .getByRole("button", { name: /insert a pub before hole 2/i })
    .click();
  const insertField = page.getByLabel(/or name the pub yourself/i);
  await expect(async () => {
    await insertField.fill("Epsilon House");
    await expect(insertField).toHaveValue("Epsilon House", { timeout: 1_000 });
    await expect(
      page.getByRole("button", { name: /insert the named pub/i }),
    ).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: /insert the named pub/i }).click();

  await expect(holeNames).toHaveText([
    "Delta Inn",
    "Epsilon House",
    "Gamma Tavern",
    "Beta Bar",
  ]);

  // ---- Remove: through the hole's own menu ----
  await page.getByRole("button", { name: /manage hole 4 · beta bar/i }).click();
  await page.getByTestId("remove-hole").click();
  await expect(holeNames).toHaveText([
    "Delta Inn",
    "Epsilon House",
    "Gamma Tavern",
  ]);

  // Par 5 on the swapped hole + 4 + 4: the dressing survived every edit
  // above, which the saved card is the honest proof of.
  const saveCourse = page.getByRole("button", {
    name: /save the course · 3 holes/i,
  });
  await expect(async () => {
    await page.getByLabel(/course name/i).fill(`Reordered ${stamp}`);
    await expect(saveCourse).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await saveCourse.click();
  await page.waitForURL(/\/courses$/);
  await expect(page.getByText(`Reordered ${stamp}`)).toBeVisible();
  await expect(page.getByText("3 holes · par 13")).toBeVisible();
});

test("pub search returns real venues when a Places key is configured", async ({
  page,
}) => {
  const stamp = Date.now();
  await signInAs(page.context(), {
    email: `search-${stamp}@e2e.local`,
    name: "Glyn",
  });

  // Probe the route first: without a key the route degrades and this
  // test has nothing to verify.
  const probe = await page.request.post("/api/places/search", {
    data: { query: "The Auld Shillelagh Stoke Newington" },
  });
  const body = (await probe.json()) as {
    degraded?: boolean;
    error?: string;
    results?: { name: string }[];
  };
  test.skip(Boolean(body.degraded), "No GOOGLE_PLACES_API_KEY configured");
  test.skip(
    !probe.ok(),
    `Places key unusable: ${body.error ?? probe.status()}`,
  );

  expect(body.results?.length).toBeGreaterThan(0);

  // And through the UI: search, add the top result as hole 1.
  await page.goto("/courses/new");
  await page.getByLabel(/pub search|search pubs/i).fill("The Auld Shillelagh");
  await page
    .getByRole("button", { name: /add .* as hole 1/i })
    .first()
    .click();
  await expect(page.getByText(/1 holes so far/i)).toBeVisible();
});
