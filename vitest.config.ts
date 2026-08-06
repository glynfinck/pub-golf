import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

// The db project talks to the local stack with the service-role key, which
// lives in .env.local beside the URL and anon key — the same trick
// playwright.config.ts uses, for the same reason. Workers are forked from this
// process, so they inherit whatever is loaded here.
dotenv.config({ path: ".env.local", quiet: true });

// `@/x` → <repo>/x, matching tsconfig's paths. Match the slash: a bare "@"
// alias is a prefix match and would also swallow "@supabase/ssr".
// Projects do not inherit the root `resolve`, so each one carries this.
const alias = [
  { find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) },
];

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
          // Pure functions only: no stack, no network, no fixtures. A unit
          // test that needs more than five seconds has stopped being one.
          testTimeout: 5_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          globalSetup: ["tests/db/global-setup.ts"],
          setupFiles: ["tests/db/setup.ts"],
          // One conversation with the database at a time: every file seeds
          // real rows into the single local stack, and two files racing on it
          // is the flake Playwright avoids with workers: 1. singleFork runs
          // every file in one process, one after another.
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          maxConcurrency: 1,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // A retried RLS test is a lie — either the policy allows it or it
          // does not. A flake here means the fixture is wrong.
          retry: 0,
        },
      },
    ],
  },
});
