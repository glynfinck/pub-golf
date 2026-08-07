/**
 * The quiet window around a server action.
 *
 * When this tab commits a write, the action's own revalidate payload already
 * carries the fresh round state — but Postgres tells the realtime socket
 * about the same write, and `useLiveRound` would answer with a second full
 * refresh over the same pub wifi. While an action is in flight (and for a
 * beat after it settles) refreshes are deferred, never dropped: a write from
 * another phone landing inside the window still refreshes when it closes.
 *
 * Module state on purpose — the window is a property of this tab, shared by
 * whichever hook is acting and whichever hook is listening.
 */

/** An action that hangs never mutes the round for good. */
export const ACTION_QUIET_CAP_MS = 15_000;
/** The echo of our own write usually arrives within this of settling. */
export const ACTION_QUIET_TAIL_MS = 750;
/** Long enough to cover a route change over a pub's wifi. */
export const ACTION_NAV_HOLD_MS = 3_000;

let quietUntil = 0;
let navUntil = 0;

export function actionStarted(now: number): void {
  quietUntil = now + ACTION_QUIET_CAP_MS;
}

export function actionSettled(now: number): void {
  quietUntil = now + ACTION_QUIET_TAIL_MS;
}

/**
 * Hold refreshes across a route change an action just started.
 *
 * A router.push racing our own router.refresh() is not a draw: the refresh
 * aborts the navigation and leaves the tapper on the page they were trying
 * to leave. That is what "Reopen hole" looked like — the caddy tapped it,
 * the round really did reopen for everyone, and their own screen snapped
 * back to the marker's card as if the button were broken.
 *
 * Tracked apart from the action's own window rather than folded into it,
 * because actionSettled fires when the ACTION settles and would otherwise
 * shrink the hold out from under a navigation still in flight.
 */
export function actionNavigating(now: number): void {
  navUntil = now + ACTION_NAV_HOLD_MS;
}

/** When realtime-triggered refreshes may fire again (epoch ms). */
export function refreshQuietUntil(): number {
  return Math.max(quietUntil, navUntil);
}
