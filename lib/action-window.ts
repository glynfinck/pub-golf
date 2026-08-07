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

let quietUntil = 0;

export function actionStarted(now: number): void {
  quietUntil = now + ACTION_QUIET_CAP_MS;
}

export function actionSettled(now: number): void {
  quietUntil = now + ACTION_QUIET_TAIL_MS;
}

/** When realtime-triggered refreshes may fire again (epoch ms). */
export function refreshQuietUntil(): number {
  return quietUntil;
}
