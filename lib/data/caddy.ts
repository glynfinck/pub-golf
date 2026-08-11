import { readBrief } from "@/lib/caddy/brief";
import { CADDY_COURSES_PER_FEE } from "@/lib/caddy/credits";
import type { PlannedCourse } from "@/lib/caddy/plan";
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
 * How long a walked-away-from session is still worth resuming.
 *
 * The green fee's own day. The dossier is Google's atmosphere data and review
 * snippets, held for the length of one conversation on purpose — a session
 * still open a week later is not a conversation, it is a cupboard. Twelve
 * hours is comfortably a night out and comfortably inside the pass.
 */
export const RESUMABLE_HOURS = 12;

/**
 * The host's most recent unfinished caddy session, if there is one worth
 * picking up.
 *
 * Finished sessions never resume: `closeCaddySession` stamps `completed_at`
 * and empties the dossier when a course is saved, so a completed row has
 * nothing left to continue with and the host has what they came for.
 *
 * Read on the caller's own session, so RLS is the thing deciding whose this
 * is — `caddy_sessions` is visible to its host and to nobody else, which makes
 * "the most recent one" unambiguous without a single `eq` on a user id.
 */
export async function resumeCaddy(): Promise<ResumedCaddy | null> {
  const supabase = await createClient();
  const since = new Date(Date.now() - RESUMABLE_HOURS * 3_600_000).toISOString();

  const { data: session } = await supabase
    .from("caddy_sessions")
    .select("id, brief, course_id")
    .is("completed_at", null)
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session) return null;

  // The brief is read through `readBrief` even though nothing here uses it
  // yet: a session whose brief no longer parses is one this build cannot
  // continue, and offering to resume it would put a card on the table that the
  // next tweak would fail against.
  if (!readBrief(session.brief)) return null;

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
