import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// e2e/auth.ts mints host sessions with the service role key, which lives in
// .env.local alongside the stack's URL and anon key. Playwright does not read
// dotenv files on its own.
dotenv.config({ path: ".env.local", quiet: true });

/**
 * E2E against the local Supabase stack (ports 54330-54334). Two browser
 * contexts play a real round against real Postgres + Realtime, so
 * `supabase start` must be running first.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // One round at a time — tests share the local database.
  workers: 1,
  use: {
    baseURL: "http://localhost:3105",
    ...devices["Pixel 7"],
  },
  webServer: {
    command: "npx next dev -p 3105",
    url: "http://localhost:3105/signin",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
