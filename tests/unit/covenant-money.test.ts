import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The covenant's money rule, as a test rather than as taste.
 *
 * "Money speaks only at round creation and the results afterglow; no guilt
 * declines; no countdown sales clocks" was prose, and prose loses. It lost
 * quietly: the caddy shipped a `Green fee · £12` badge on a collapsed card
 * nobody had opened, and a footer sentence under a form nobody had submitted,
 * on a page whose entire other half is the free hand-plotting builder. Neither
 * was argued for; both simply accreted, because there was nothing to fail.
 *
 * The audit (`docs/CADDY-DESIGN-AUDIT.md` §7.1) settled the rule as: **a price
 * may render only in answer to a refusal the host walked into, or on the two
 * surfaces that exist to talk about money.** That is checkable, and this is
 * the check.
 *
 * It works on imports rather than on rendered output, which is the only honest
 * place to put it: a price reaches a screen exactly one way — through
 * `lib/tariff.ts`, or through the offer list in `lib/caddy/credits.ts` that
 * reads it — so the set of modules holding either is the set of modules that
 * can quote one. A new file in that set is a decision, and it should have to
 * be made here, out loud, rather than in a diff nobody reads twice.
 */

const ROOT = path.join(import.meta.dirname, "..", "..");

/**
 * Every place a price may legitimately be held, and why.
 *
 * Two kinds of entry, and the distinction is the whole rule. A **surface** may
 * quote a price to a person. A **workshop** does arithmetic with one and
 * renders nothing — `budget.ts` sizes the caddy's own bill against the fee,
 * `credits.ts` owns the top-up ladder that the refusal sheet reads.
 */
const ALLOWED = new Map<string, string>([
  ["app/tariff/page.tsx", "surface: the one honest tariff, which exists to list prices"],
  ["components/course/caddy-more-sheet.tsx", "surface: the caddy's second door, opened only by a refusal"],
  ["components/round/green-fee-sheet.tsx", "surface: the caddy's first door, and round creation's own offer"],
  ["components/round/members-options.tsx", "surface: round creation, which R6 names as a place money may speak"],
  ["lib/caddy/budget.ts", "workshop: sizes the caddy's own bill against the fee; renders nothing"],
  ["lib/caddy/credits.ts", "workshop: owns the top-up ladder the refusal sheet reads"],
]);

/** Source files under the app's own directories, ignoring build output. */
function sources(dir: string): string[] {
  const here = path.join(ROOT, dir);
  const out: string[] = [];
  for (const entry of readdirSync(here, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(rel));
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const HOLDS_A_PRICE = /from "@\/lib\/tariff"|\bCADDY_TOPUP_OFFERS\b/;

describe("money speaks only where it is allowed to", () => {
  const holders = ["app", "components", "lib"]
    .flatMap((dir) => sources(dir))
    .filter((file) => HOLDS_A_PRICE.test(readFileSync(path.join(ROOT, file), "utf8")))
    // Path separators differ by platform; the allowlist is written in one.
    .map((file) => file.split(path.sep).join("/"))
    .sort();

  it("is held by exactly the modules that are allowed to hold it", () => {
    expect(holders).toEqual([...ALLOWED.keys()].sort());
  });

  it("never reaches the drafting table", () => {
    // The caddy's group renders on the course builder, beside the free
    // builder. It may say the caddy is the members' part; it may not say what
    // that costs until a host has asked for something and been refused. The
    // refusal opens `GreenFeeSheet`, which is on the list above — the price
    // arrives with the door, not before it.
    expect(holders).not.toContain("components/course/caddy-group.tsx");
    expect(holders).not.toContain("components/course/course-builder.tsx");
  });
});
