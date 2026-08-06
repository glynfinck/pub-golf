import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

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
    ],
  },
});
