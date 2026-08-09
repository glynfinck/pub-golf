/**
 * Clock maths for the shot clock and the walk between holes.
 *
 * Every function here takes the time it needs as an argument — no
 * `Date.now()` in a body — so the countdown rendering can be reasoned about
 * (and tested) without a clock, and the strict react-hooks purity rules stay
 * happy. `hooks/use-countdown.ts` remains the only sanctioned timer.
 */

/** Under two minutes turns the hole red. */
export const URGENT_MS = 120_000;

/**
 * The waiting thresholds. A tap is acknowledged instantly by its label; the
 * busy furniture (the putt, the masthead sweep) waits until the wait has
 * earned it, then holds long enough that a 420ms action never flashes it.
 */
export const BUSY_DELAY_MS = 400;
export const BUSY_MIN_VISIBLE_MS = 300;

/** How long until the busy mark may come up; 0 once it is due. */
export function busyDelayRemaining(startedAt: number, now: number): number {
  return Math.max(0, startedAt + BUSY_DELAY_MS - now);
}

/** How long a shown busy mark must stay up, so it never flashes. */
export function busyHoldRemaining(shownAt: number, now: number): number {
  return Math.max(0, shownAt + BUSY_MIN_VISIBLE_MS - now);
}

/** Whole seconds left, rounding up so a countdown never shows 0:00 early. */
export function remainingSeconds(remainingMs: number | null): number | null {
  return remainingMs === null ? null : Math.ceil(remainingMs / 1000);
}

/**
 * "7:05", or "--:--" before the first client tick (the hydration guard).
 * Minutes are unpadded — the printed card never says "07:05".
 */
export function formatClock(remainingMs: number | null): string {
  const totalSeconds = remainingSeconds(remainingMs);
  if (totalSeconds === null) return "--:--";
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Spoken form for the aria-label, so a screen reader gets words not a ratio. */
export function spokenClock(remainingMs: number | null): string | null {
  const totalSeconds = remainingSeconds(remainingMs);
  if (totalSeconds === null) return null;
  const safeSeconds = Math.max(0, totalSeconds);
  return `${Math.floor(safeSeconds / 60)} minutes ${safeSeconds % 60} seconds`;
}

/** Red below two minutes; never urgent before the first tick. */
export function isUrgent(remainingMs: number | null): boolean {
  return remainingMs !== null && remainingMs <= URGENT_MS;
}

/**
 * How much of the ring is still drawn, 1 → 0. A full ring is the resting
 * state: before the first tick, and whenever the round carries no timer.
 */
export function ringFraction(
  remainingMs: number | null,
  totalMs: number,
): number {
  if (remainingMs === null || totalMs <= 0) return 1;
  return Math.min(1, Math.max(0, remainingMs / totalMs));
}

/**
 * The shared deadline written to Postgres — one timestamp every phone counts
 * down to locally. Null minutes means this round runs without a clock.
 */
export function deadlineFrom(
  now: number,
  minutes: number | null | undefined,
): string | null {
  return minutes ? new Date(now + minutes * 60_000).toISOString() : null;
}

/**
 * The 19th-hole estimate: minutes a round takes end to end — the pubs plus
 * the walks between them. Walk minutes come from the course (measured by
 * Google when it was built), so the estimate costs nothing at round time.
 */
export function roundMinutes(
  holeCount: number,
  minutesPerPub: number,
  walkMinutesTotal: number,
): number {
  return holeCount * minutesPerPub + walkMinutesTotal;
}

/** When the 19th hole lands, given a tee-off instant. */
export function estimatedFinishMs(
  teeOffMs: number,
  totalMinutes: number,
): number {
  return teeOffMs + totalMinutes * 60_000;
}

/** "3h 55m" (or "55m", or "4h") — the pace line for an unscheduled round. */
export function formatDuration(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * "7:00 PM" from minutes since midnight, wrapping past it — a finish that
 * runs long reads as "12:40 AM", which is its own warning.
 */
export function clockTime12(minutesOfDay: number): string {
  const wrapped = ((Math.round(minutesOfDay) % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  const half = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${minutes.toString().padStart(2, "0")} ${half}`;
}

/**
 * How the clubhouse says hello, given the hour. It said "Evening" at every
 * hour of the day, which is charming at 9pm and simply wrong at brunch.
 *
 * The small hours get their own line rather than being folded into evening:
 * a round that is still on the board at 2am is the app's best case, not an
 * edge case.
 *
 * Pure, and takes the hour rather than reading a clock, like everything else
 * in this file — which is also what makes the bands testable.
 */
export function greeting(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h < 5) return "Still going";
  if (h < 12) return "Morning";
  if (h < 18) return "Afternoon";
  return "Evening";
}
