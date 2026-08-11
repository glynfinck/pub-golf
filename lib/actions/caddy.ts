"use server";

import { resumeCaddy } from "@/lib/data/caddy";
import type { PlannedCourse } from "@/lib/caddy/plan";

import {
  askTheCaddy as askTheCaddyRun,
  closeCaddySession as closeCaddySessionRun,
  planCourse as planCourseRun,
  rememberCaddyCourse as rememberCaddyCourseRun,
  type CaddyResult,
} from "@/lib/caddy/run";

/**
 * The caddy's server actions — a shim, and only a shim.
 *
 * The pipeline itself lives in `lib/caddy/run.ts`. It moved there because a
 * `"use server"` module may export nothing but async actions, and the streamed
 * plan (`app/api/caddy/plan/route.ts`) needs the pieces in the middle: the
 * patch, so the map can be framed before the card exists, and `runTurn`, so
 * there is still exactly one path from a brief to a charge.
 *
 * Everything below is the same function it always was, reached the same way.
 * Keeping the boundary here rather than deleting it means every client import
 * is unchanged and the "which of these is an action?" question has one
 * answer: the ones in this file.
 *
 * **Async functions and nothing else.** Not even a re-exported type. This
 * file briefly carried `export type { CaddyResult }` as a convenience, and it
 * compiled, typechecked and built without complaint — then threw
 * `ReferenceError: CaddyResult is not defined` at module evaluation the first
 * time a real server rendered it, taking `/courses/new` and every saved course
 * with it. Turbopack's `"use server"` transform rewrites this module's export
 * list and emitted a runtime reference to a name TypeScript had already
 * erased. The constraint is documented and it is not a style preference:
 * anyone wanting the type imports it from `@/lib/caddy/run`, where it lives.
 */

/** Plan a course from a brief: gather the patch, then ask once. */
export async function planCourse(rawBrief: unknown): Promise<CaddyResult> {
  return planCourseRun(rawBrief);
}

/** Roll a fresh card, or answer something the host said. */
export async function askTheCaddy(input: {
  sessionId: string;
  ask?: string;
  holeNumber?: number | null;
  roll?: boolean;
}): Promise<CaddyResult> {
  return askTheCaddyRun(input);
}

/** Record which course a caddy session filed, so a refresh does not file a
 * second one. */
export async function rememberCaddyCourse(
  sessionId: string,
  courseId: string,
): Promise<void> {
  return rememberCaddyCourseRun(sessionId, courseId);
}

/** The session is finished: stamp it and drop the dossier. */
export async function closeCaddySession(sessionId: string): Promise<void> {
  return closeCaddySessionRun(sessionId);
}

/**
 * Did a card land after all?
 *
 * The card is written to `caddy_turns` before anything is streamed, so a plan
 * whose connection dies on the way back has still produced one — it is sitting
 * in Postgres, paid for, while the host reads an error. That happened for real:
 * a 32.21p plan finished, filed a nine-hole card, and the browser showed a
 * timeout.
 *
 * So the failure path asks before it apologises. Reads the host's own most
 * recent session through RLS, which is what makes "theirs" unambiguous without
 * naming a user.
 */
export async function collectCaddyCard(): Promise<{
  sessionId?: string;
  course?: PlannedCourse;
}> {
  const resumed = await resumeCaddy();
  if (!resumed) return {};
  return { sessionId: resumed.sessionId, course: resumed.course };
}
