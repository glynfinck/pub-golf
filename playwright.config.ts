import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// e2e/auth.ts mints host sessions with the service role key, which lives in
// .env.local alongside the stack's URL and anon key. Playwright does not read
// dotenv files on its own.
dotenv.config({ path: ".env.local", quiet: true });

/**
 * E2E against the local Supabase stack (ports 54330-54334). Multiple browser
 * contexts play a real round against real Postgres + Realtime, so
 * `supabase start` must be running first.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // The realtime assertions race the socket's first subscribe on a cold stack
  // — a known flake, not a product failure (see CLAUDE.md). Without retries it
  // would block production deploys, since the deploy job gates on this suite.
  retries: process.env.CI ? 2 : 1,
  // One round at a time — tests share the local database.
  workers: 1,
  // CI's default reporter is `dot`, which buffers a wall of dots while a
  // three-engine matrix runs for minutes — from the outside that reads as
  // hung. `list` streams a line per test with its duration as it finishes,
  // `github` pins failures to the PR diff as annotations, and `html` gives
  // the report-upload step something real to upload at last.
  reporter: process.env.CI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL: "http://localhost:3105",
    // A full step-by-step trace, recorded only when a test needs a retry —
    // the deep dive exactly where it's wanted, free on green runs. Traces
    // land in test-results/, which CI already uploads.
    trace: "on-first-retry",
  },
  // The platform matrix: every spec runs once per row, engine × form factor.
  // A round is played on whatever the table pulls out of their pockets, so
  // the suite drinks in all three engines — Android Chrome (Blink), iOS
  // Safari (WebKit, the one that cannot be swapped out on an iPhone), and a
  // laptop at the table (Gecko). Projects run in sequence under workers: 1.
  projects: [
    { name: "android-chrome", use: { ...devices["Pixel 7"] } },
    { name: "iphone-safari", use: { ...devices["iPhone 15"] } },
    { name: "desktop-firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    // CI has already run `next build` by the time this suite starts, so it
    // serves the production build instead of paying dev-mode compilation
    // for every route × engine — the single biggest cost of the matrix on a
    // two-core runner. Locally, dev stays dev: no rebuild between edits.
    command: process.env.CI ? "npx next start -p 3105" : "npx next dev -p 3105",
    url: "http://localhost:3105/signin",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
