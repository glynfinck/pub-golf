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
  timeout: process.env.CI ? 180_000 : 90_000,
  // 15s locally, 30s on CI, and the number is not arbitrary. Most waits here
  // are one phone waiting on another phone's write, which travels as a
  // realtime event — and when an event is missed, `useLiveRound`'s safety-net
  // poll is what catches up, on a POLL_MS of 10s. That leaves under five
  // seconds for a fetch, a server render and a hydration before a 15s
  // expectation gives up, which is comfortable on a laptop and simply is not
  // on a two-core runner already hosting Postgres, PostgREST, Realtime, Next
  // and WebKit. The gap between the product's catch-up interval and the
  // suite's patience was the flake.
  expect: { timeout: process.env.CI ? 30_000 : 15_000 },
  // Retries exist to produce evidence, not to launder a red run: a retried
  // test records a trace (see `trace` below), and `failOnFlakyTests` then
  // fails the run anyway. Green has to mean green — a pass-on-retry once hid
  // a real scoring bug (swigs written inside the hole-out debounce were
  // refused, and the hole silently scored the par substitute) behind three
  // "flaky" lines and a green check.
  retries: process.env.CI ? 2 : 1,
  failOnFlakyTests: !!process.env.CI,
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
