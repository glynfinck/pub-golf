import { test, expect, type Page } from "@playwright/test";

const MAILPIT = "http://127.0.0.1:54334";

async function fetchOtpCode(email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const list = await fetch(`${MAILPIT}/api/v1/messages?limit=10`).then(
      (response) => response.json(),
    );
    const message = list.messages?.find(
      (entry: { To: { Address: string }[] }) =>
        entry.To?.some((to) => to.Address === email),
    );
    if (message) {
      const detail = await fetch(
        `${MAILPIT}/api/v1/message/${message.ID}`,
      ).then((response) => response.json());
      const match = `${detail.Text} ${detail.HTML}`.match(/\b(\d{6})\b/);
      if (match) return match[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No OTP email arrived for ${email}`);
}

async function signIn(page: Page, email: string, name: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/name on the card/i).fill(name);
  await page.getByRole("button", { name: /email me a tee-off code/i }).click();
  const code = await fetchOtpCode(email);
  await page.getByLabel(/enter the 6-digit code/i).fill(code);
  await page.getByRole("button", { name: /^tee off$/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("build a course by hand, then play a round on it", async ({ page }) => {
  const stamp = Date.now();
  await signIn(page, `builder-${stamp}@e2e.local`, "Glyn");

  // ---- Plot a two-pub course by name (works with or without a key) ----
  await page.goto("/courses/new");
  await page.getByLabel(/course name/i).fill(`Two Pub Crawl ${stamp}`);

  await page.getByLabel(/add a pub by name/i).fill("The Test Tavern");
  await page.getByRole("button", { name: /add the named pub/i }).click();
  await page.getByLabel(/add a pub by name/i).fill("The Other Arms");
  await page.getByRole("button", { name: /add the named pub/i }).click();

  // Dress hole 1: par up, a proper drink, a water hazard with a note.
  await page.getByRole("button", { name: /raise par on hole 1/i }).click();
  await page.getByLabel(/^the drink$/i).first().fill("Pint of the black stuff");
  await page.getByRole("button", { name: /^water$/i }).first().click();
  await page
    .getByLabel(/hazard note for hole 1/i)
    .fill("No toilet for the whole hole");

  await page.getByRole("button", { name: /save the course · 2 holes/i }).click();
  await page.waitForURL(/\/courses$/);
  await expect(page.getByText(`Two Pub Crawl ${stamp}`)).toBeVisible();
  await expect(page.getByText("2 holes · par 9")).toBeVisible();

  // ---- The saved course appears in the round wizard and plays ----
  await page.goto("/new");
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
});

test("pub search returns real venues when a Places key is configured", async ({
  page,
}) => {
  const stamp = Date.now();
  await signIn(page, `search-${stamp}@e2e.local`, "Glyn");

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
