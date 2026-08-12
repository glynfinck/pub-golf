/**
 * How long a caddy conversation stays open.
 *
 * One number, in its own module, because two sides have to agree on it and
 * they sit in different layers: `lib/data/caddy.ts` decides whether a session
 * can be resumed, and `lib/caddy/run.ts` decides when its patch is swept. If
 * those two ever disagreed the result is the worst shape available — a session
 * the screen offers to continue and the pipeline then refuses, which is
 * exactly the bug this window's enforcement used to have.
 *
 * The green fee's own day. The dossier is Google's atmosphere data and review
 * snippets, held for the length of one conversation on purpose — a session
 * still open a week later is not a conversation, it is a cupboard. Twelve
 * hours is comfortably a night out and comfortably inside the pass.
 *
 * Note what it is measured from: `created_at`, not the last turn. A
 * conversation does not renew itself by being talked to, or a session poked
 * once an hour would hold Google's data indefinitely.
 */
export const RESUMABLE_HOURS = 12;

/** The cutoff, as an ISO string — the one place the hours become a timestamp.
 * Takes `now` rather than reading the clock, per the house rule that keeps
 * `Date.now()` out of functions that can be tested without it. */
export function resumableSince(now: number): string {
  return new Date(now - RESUMABLE_HOURS * 3_600_000).toISOString();
}

/**
 * Is there still a patch to talk about?
 *
 * The second thing two layers have to agree on, and for the same reason as the
 * window above. `askTheCaddy` refuses a session whose dossier is empty — there
 * is nothing to swap a pub for — and the screen has to make the same call, or
 * it renders an ask box whose every answer is "That patch has been put away".
 *
 * Deliberately shaped to take `unknown`: one side reads it off a jsonb column
 * and the other off a parsed row, and neither should have to assert a type to
 * ask a question this simple.
 */
export function patchIsOpen(dossier: unknown): boolean {
  return Array.isArray(dossier) && dossier.length > 0;
}
