import { afterEach } from "vitest";

import { cleanupScope } from "@/tests/support/scope";

// Nothing truncates between runs and there is no seed.sql, so every test takes
// its own rows back out — including a failing one, which is exactly when
// leftovers would poison the next test and the Playwright run after it.
afterEach(async () => {
  await cleanupScope();
});
