import { expect, type Page } from "@playwright/test";

/** How long one sip may retry before the test calls it lost. */
const SIP_TIMEOUT = 15_000;

/**
 * Tap +1 SWIG `count` times, proving each sip landed before the next.
 *
 * A bare tap loop is the counting-then-acting bug in miniature: a realtime
 * refresh can hold the outgoing and incoming play view mounted together for
 * a beat, and a tap that lands on the outgoing copy updates state nobody
 * keeps. Five taps then one assertion reads "3" and cannot say which two
 * sank. So: read, tap only if the count still wants it, and prove the digit
 * — as one retried block per sip. A swallowed tap gets retried; a
 * landed-but-slow one is never doubled, because the re-read sees it first.
 */
export async function drink(page: Page, count: number) {
  const counter = page.getByTestId("swig-count");
  for (let sip = 1; sip <= count; sip += 1) {
    await expect(async () => {
      const now = Number(
        (await counter.textContent({ timeout: 1_000 })) ?? "0",
      );
      if (now < sip) {
        await page.getByTestId("swig-plus").click({ timeout: 1_000 });
      }
      await expect(counter).toHaveText(String(sip), { timeout: 2_000 });
    }).toPass({ timeout: SIP_TIMEOUT });
  }
}
