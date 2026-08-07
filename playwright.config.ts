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
  use: {
    baseURL: "http://localhost:3105",
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
    command: "npx next dev -p 3105",
    url: "http://localhost:3105/signin",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
