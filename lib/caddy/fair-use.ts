/**
 * Fair use: the backstop nobody is meant to meet.
 *
 * The caddy is deliberately **not metered on screen** — no counter, no "rolls
 * left", no meter that turns red. A host asks for as many tweaks and rolls as
 * it takes, because a cached patch makes the marginal ask cost pennies and
 * because a visible allowance reads as credits rather than membership.
 *
 * What that needs underneath is armour against scripts rather than against
 * people, and this is it: a ceiling several times a heavy honest session, held
 * in Postgres where a serverless function cannot outrun it. Hand-kept mirror
 * of `public.caddy_fair_use_cap()`; the database is the enforcement and this
 * copy only writes the one line of copy a host could ever see. A db test calls
 * the function and fails if the two drift apart — a cap the screen misquotes
 * is a host told the caddy is broken when it is merely finished.
 */
export const CADDY_FAIR_USE_PER_DAY = 25;

/** How many caddy calls this fee has made in the last rolling day. Only calls
 * that produced a card are ever in the ledger — a refusal, a cancel and a
 * model error are not the host's fault and are not counted. */
export function caddyTurnsSpent(
  turnTimes: readonly string[],
  nowMs: number,
): number {
  const since = nowMs - 24 * 3_600_000;
  return turnTimes.filter((at) => {
    const when = Date.parse(at);
    return Number.isFinite(when) && when > since;
  }).length;
}

/** Is this fee out of shift? Mirrors the trigger's comparison exactly, down to
 * the `>=`: the cap is the number of calls allowed, so the 26th is the one
 * that is refused. */
export function caddyFairUseSpent(
  turnTimes: readonly string[],
  nowMs: number,
  cap: number = CADDY_FAIR_USE_PER_DAY,
): boolean {
  return caddyTurnsSpent(turnTimes, nowMs) >= cap;
}

/**
 * What the host reads if they ever get here. Names no number — the feature has
 * never shown them one, and inventing a figure at the moment of refusal would
 * be the first and worst time to start.
 */
export const CADDY_FAIR_USE_NOTE =
  "The caddy's done a full shift on this fee. The drafting table is all yours from here — every edit free, as always.";
