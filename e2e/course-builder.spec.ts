import { test, expect } from "@playwright/test";

import { signInAs } from "./auth";
import { expectSettled } from "./nav";

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
  // Same controlled-form race full-house documents: a fill landing before
  // hydration is silently wiped, so prove the page live through the Add
  // button (it enables only when React sees text) before typing the name.
  const pubField = page.getByLabel(/add a pub by name/i);
  const addPub = page.getByRole("button", { name: /add the named pub/i });
  await expect(async () => {
    await pubField.fill("The Test Tavern");
    await expect(addPub).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });

  await addPub.click();
  await pubField.fill("The Other Arms");
  await addPub.click();

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
