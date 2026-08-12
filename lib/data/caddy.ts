import { readBrief } from "@/lib/caddy/brief";
import { CADDY_COURSES_PER_FEE } from "@/lib/caddy/credits";
import type { PlannedCourse } from "@/lib/caddy/plan";
import { patchIsOpen, resumableSince } from "@/lib/caddy/window";
import { createClient } from "@/lib/supabase/server";

/**
 * The conversation a host walked away from, found again.
 *
 * A refresh used to throw away more than it looked like. The card survived —
 * a caddy course files itself the moment it lands — but the *thread* to it did
 * not: `sessionId` and the filed course's id are both React state, so a
 * reloaded drafting table knew neither. Two things went wrong, and the second
 * is worse than the first.
 *
 *   The host lost the ability to tweak. The dossier, the brief and every card
 *   are all still in Postgres, but the screen had forgotten which session they
 *   belonged to, so the only way on was to plan again — paying for a fresh
 *   Places gather and a fresh loop to redo work already sitting in the
 *   database.
 *
 *   And the next card filed a **second course**. The builder no longer knew it
 *   had already written one, so refresh twice, plan twice, and a host has
 *   three near-identical courses in their book. Auto-filing made the work
 *   durable and then lost the thread to it, which is the worse half of the two.
 *
 * So the drafting table asks the server instead of remembering. Nothing new is
 * stored for this: it is the row the plan already wrote, its most recent turn,
 * and the course that turn filed. A server read rather than `sessionStorage`
 * on purpose — `lib/new-round-draft.ts` parks a form in session storage
 * because the server genuinely cannot see it, whereas all of this the server
 * can, and a database read also survives a new tab, a closed browser and
 * picking the phone back up, which session storage survives none of.
 */

export interface ResumedCaddy {
  sessionId: string;
  /** The last card this session produced, ready to go back on the table. */
  course: PlannedCourse;
  /** The course row the session filed, so the next card writes over it rather
   * than minting a second. This is the duplicate bug's actual fix. */
  courseId: string | null;
}


/**
 * The host's most recent unfinished caddy session, if there is one worth
 * picking up.
 *
 * Finished sessions resume as well as unfinished ones. `closeCaddySession`
 * still stamps `completed_at` when a course is saved, but that marks "this
 * produced a card", not "you may not ask again" — the host keeps a tweak
 * quota, and the card, brief and dossier they would need are all still in
 * Postgres. The patch survives the save and is swept when the session falls
 * out of the window below; a genuinely new patch is a new plan.
 *
 * Read on the caller's own session, so RLS is the thing deciding whose this
 * is — `caddy_sessions` is visible to its host and to nobody else, which makes
 * "the most recent one" unambiguous without a single `eq` on a user id.
 */
export async function resumeCaddy(): Promise<ResumedCaddy | null> {
  return latestSession(null);
}

/**
 * The conversation that produced *this* course, if it is still open.
 *
 * The saved-course screen's version of the same question, and the difference
 * matters: on `/courses/[id]` the host is looking at one particular card, so
 * "your most recent session" is the wrong answer whenever they have planned
 * something else since. Asking by `course_id` means the caddy that appears
 * beside a course is the one that wrote it.
 *
 * Null is an ordinary answer — a hand-built course never had a session, and a
 * caddy course older than the window has had its patch swept. Both mean the
 * same thing on screen: this is the manual table, as it always was.
 */
export async function resumeCaddyForCourse(
  courseId: string,
): Promise<ResumedCaddy | null> {
  return latestSession(courseId);
}

/**
 * A conversation about this course that is over only because its patch went.
 *
 * The difference between "there is no caddy here" and "the caddy is here and
 * needs a moment" — and it is worth the extra read, because those look
 * identical from outside and mean opposite things to a host with tweaks left
 * on their fee.
 *
 * Deliberately narrow: in the window, about this course, has produced a card,
 * and has no patch. Anything else answers null and the screen shows what it
 * showed before. Returns the session id, which is all `reopenCaddyPatch`
 * needs — everything it re-gathers from is already on the row.
 */
export async function caddyReopenable(courseId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: session } = await supabase
    .from("caddy_sessions")
    .select("id, brief, dossier")
    .eq("course_id", courseId)
    .gt("created_at", resumableSince(Date.now()))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session || !readBrief(session.brief)) return null;
  // An open patch is `resumeCaddyForCourse`'s business, not this one's.
  if (patchIsOpen(session.dossier)) return null;

  // A session that never produced a card has nothing to pick back up; the
  // host closed the tab mid-plan and was never charged for it.
  const { count } = await supabase
    .from("caddy_turns")
    .select("id", { count: "exact", head: true })
    .eq("session_id", session.id)
    .eq("failed", false);
  return count && count > 0 ? session.id : null;
}

async function latestSession(
  courseId: string | null,
): Promise<ResumedCaddy | null> {
  const supabase = await createClient();
  const since = resumableSince(Date.now());

  let query = supabase
    .from("caddy_sessions")
    // The dossier comes back so its emptiness can be checked, and it is the
    // biggest thing this reads — forty pubs of Google's facts and review
    // snippets. Worth it, because the alternative is a door that opens onto a
    // refusal: `askTheCaddy` answers a patchless session with "That patch has
    // been put away", and there is no way to tell from the outside except to
    // look. Sessions saved before the sweep moved to the window are exactly
    // this shape, so it is not a theoretical case.
    .select("id, brief, course_id, dossier")
    // Completed sessions resume too, which reverses the original rule.
    //
    // `completed_at` was terminal when a fee bought exactly one course: saving
    // it was the end of the thread because there was nothing left to spend. It
    // is not the end any more — tweaks are their own quota now, and a host who
    // saves a course and comes back to it should be able to keep asking rather
    // than be told the conversation is over. Refusing them meant paying for a
    // fresh gather and a fresh plan to redo work already sitting in Postgres.
    //
    // The window below still applies, so this resumes a conversation rather
    // than opening a cupboard.
    .gt("created_at", since);
  if (courseId) query = query.eq("course_id", courseId);

  const { data: session } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session) return null;

  // The brief is read through `readBrief` even though nothing here uses it
  // yet: a session whose brief no longer parses is one this build cannot
  // continue, and offering to resume it would put a card on the table that the
  // next tweak would fail against.
  if (!readBrief(session.brief)) return null;

  // Same rule, for the patch. A session whose dossier has been swept has a
  // card and a history and nothing to change them against, so it is finished
  // even though every other column says otherwise. Offering it would put an
  // ask box on screen whose every answer is a refusal.
  if (!patchIsOpen(session.dossier)) return null;

  const { data: turn } = await supabase
    .from("caddy_turns")
    .select("result")
    .eq("session_id", session.id)
    .eq("failed", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // A session with no card yet is one where the host closed the tab mid-plan.
  // There is nothing to put back, and the turn was never charged.
  if (!turn?.result) return null;

  const course = turn.result as unknown as PlannedCourse;
  if (!Array.isArray(course.holes) || course.holes.length === 0) return null;

  return {
    sessionId: session.id,
    course,
    courseId: session.course_id ?? null,
  };
}


/**
 * What the host's fee still has to give, and where the last one went.
 *
 * Shown rather than hidden, which is the opposite of how the other ceilings
 * are treated and deliberately so. Fair use and the runaway breaker are
 * backstops nobody should ever meet, and `lib/caddy/fair-use.ts` argues at
 * length that putting a counter on screen turns membership into credits. The
 * re-design quota is not that: it is the thing the host bought, and one who
 * cannot see whether theirs is spent finds out by being refused — the single
 * way of learning it that feels like a wall.
 *
 * Only the re-designs. Tweaks have a quota too and it stays invisible: a meter
 * on "ask as often as you like" is the same mistake seen from the other side.
 */
export interface CaddyAllowance {
  /** There is a fee with a course still to plan. */
  canPlan: boolean;
  /** How many courses the host's live fees still hold between them. Shown,
   * because "Covered" on a fee with nothing left to give is the app telling a
   * host they have something they do not. */
  left: number;
  /** The course a spent fee is holding, so the screen can point at it rather
   * than describe it. Null when nothing is spent, and null on a database that
   * has not caught up. */
  courseId: string | null;
}

export async function caddyAllowance(): Promise<CaddyAllowance> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { canPlan: false, left: 0, courseId: null };

  // The countable quota, and the only one shown. Tweaks have an allowance too
  // and it is deliberately invisible — a meter on "ask as often as you like"
  // turns membership back into credits.
  const { data: left, error } = await supabase.rpc("caddy_balance", {
    who: user.id,
    quota: "redesign",
  });
  // The ledger is not on this database yet. Say yes, exactly as `liveFee` does
  // in the same window — the two must agree, or the screen offers a plan the
  // pipeline then refuses.
  if (error) return { canPlan: true, left: CADDY_COURSES_PER_FEE, courseId: null };

  const remaining = Number(left ?? 0);
  if (remaining > 0) return { canPlan: true, left: remaining, courseId: null };

  // Spent. Find what it is holding, so the answer can be a door rather than a
  // sentence. Read on the caller's own session: RLS makes "theirs" the only
  // thing this can see.
  const { data: filed } = await supabase
    .from("caddy_sessions")
    .select("course_id")
    .not("course_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { canPlan: false, left: 0, courseId: filed?.course_id ?? null };
}
