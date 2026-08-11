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
  // 30s locally, 45s on CI, and the numbers are not arbitrary: they are the
  // product's own worst-case catch-up plus room to render it. Most waits here
  // are one phone waiting on another phone's write, which travels as a
  // realtime event — and the socket is a hint, not a contract, so the number
  // that matters is how long a phone can take when an event is simply
  // dropped. Two terms, both read off the source:
  //
  //   POLL_MS               10s  the safety-net poll in use-live-round.ts
  //   ACTION_QUIET_CAP_MS   15s  the deferral in lib/action-window.ts
  //                        ----
  //                         25s  before the refetch is even allowed to start
  //
  // The earlier budget counted the poll and missed the quiet window, which
  // left ~5s on CI for an RSC fetch, a server render and a hydration — and
  // `full-house` on WebKit spends that just being twenty phones. It timed
  // out at 30s waiting for the play view after a tee-up, then passed on
  // retry, which under failOnFlakyTests is a red run.
  //
  // Raising this absorbs latency, not wrongness: an assertion that waits for
  // the right value still fails on the wrong one, and a view that never
  // arrives still fails — only slower. The thing it must never become is a
  // number picked to make a red go away, which is why the arithmetic is
  // written out rather than the result.
  //
  // The real fix is one layer down: the safety-net poll defers behind the
  // action quiet window, though it is the net for a *dropped* event rather
  // than the echo of our own write, so a phone that missed one can sit ~25s
  // behind. Narrowing that is a change to live-round machinery and wants its
  // own branch and its own reproduction.
  expect: { timeout: process.env.CI ? 45_000 : 30_000 },
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
    // The billing webhook spec never opens a page, so the matrix owes it
    // nothing — and it must be ignored here rather than runtime-skipped:
    // a skip leaves the file's afterAll running in a worker whose
    // beforeAll never ran, which crashes teardown against the last test.
    {
      name: "iphone-safari",
      use: { ...devices["iPhone 15"] },
      testIgnore: /billing-webhook/,
    },
    {
      name: "desktop-firefox",
      use: { ...devices["Desktop Firefox"] },
      testIgnore: /billing-webhook/,
    },
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
