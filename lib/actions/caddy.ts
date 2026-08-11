"use server";

import {
  askTheCaddy as askTheCaddyRun,
  closeCaddySession as closeCaddySessionRun,
  planCourse as planCourseRun,
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
 */

export type { CaddyResult };

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

/** The session is finished: stamp it and drop the dossier. */
export async function closeCaddySession(sessionId: string): Promise<void> {
  return closeCaddySessionRun(sessionId);
}
