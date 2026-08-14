/**
 * Opening hours, as arithmetic.
 *
 * A route is a schedule: nothing else in the pipeline can know whether a pub
 * will be open when the group actually reaches it, and a shut door at hole 5
 * is the never-invent-a-pub failure arriving by another road. This module is
 * the whole of what "open" means — parsing Google's periods once, and
 * answering the two questions the router and the contract ask: *open at this
 * minute?* and *open for how much longer?*
 *
 * **Pure, and clock-free.** Days and minutes arrive as arguments; the one
 * place a clock is read is the brief screen, where the host picked
 * "tonight". Same rule as `lib/time.ts`, for the same reason.
 *
 * **Unknown never punishes.** A pub Google publishes no hours for answers
 * `null` everywhere, and every caller treats null as open — a thin-data
 * patch must not read as a town that shut early.
 */

/** One opening window. Minutes from midnight, `day` 0 (Sunday) to 6, and
 * `close` may exceed 1440: a Friday 23:00–02:00 is `{ day: 5, open: 1380,
 * close: 1560 }`, which is how "open past midnight" stays one window. */
export interface OpenWindow {
  day: number;
  open: number;
  close: number;
}

/** How long the group sits over each drink before walking on. The house
 * paces a hole around this; the ETA model only needs it roughly right. */
export const DWELL_MINUTES = 25;

/** The finish keeps a margin: it is the hole nobody leaves, and arriving
 * twenty-nine minutes before the towels go up is not a finale. */
export const LAST_ORDERS_MARGIN = 30;

/** When the round tees off: the weekday (0 Sunday … 6 Saturday, resolved by
 * the browser where "tonight" was tapped) and minutes from midnight. */
export interface TeeOff {
  day: number;
  minutes: number;
}

interface GooglePoint {
  day?: number;
  hour?: number;
  minute?: number;
}

/**
 * Google's `regularOpeningHours.periods`, folded to windows.
 *
 * Null for anything unusable — no periods, or a period with an open and no
 * close, which is Google's spelling of "always open". Either way the pub
 * passes every check, which is the honest reading of both.
 */
export function windowsOf(
  periods:
    | { open?: GooglePoint; close?: GooglePoint }[]
    | null
    | undefined,
): OpenWindow[] | null {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  const windows: OpenWindow[] = [];
  for (const period of periods) {
    const open = period.open;
    if (
      typeof open?.day !== "number" ||
      typeof open.hour !== "number" ||
      open.day < 0 ||
      open.day > 6
    ) {
      continue;
    }
    // An open with no close is Google's "always open" — the whole answer is
    // unknown-shaped, so the whole answer is null.
    const close = period.close;
    if (
      typeof close?.day !== "number" ||
      typeof close.hour !== "number" ||
      close.day < 0 ||
      close.day > 6
    ) {
      return null;
    }
    const openAtMin = open.hour * 60 + (open.minute ?? 0);
    let closeAtMin = close.hour * 60 + (close.minute ?? 0);
    // Past midnight: the close belongs to the next day, so it rides past
    // 1440 on the open's own day. (Google only ever spills one day.)
    if (close.day !== open.day) closeAtMin += 1440;
    if (closeAtMin <= openAtMin) continue;
    windows.push({ day: open.day, open: openAtMin, close: closeAtMin });
  }
  return windows.length > 0 ? windows : null;
}

/** The window containing this minute, honouring the previous evening's
 * spill-over — at 00:30 Saturday, Friday's 23:00–02:00 is the one open. */
function containing(
  hours: OpenWindow[],
  day: number,
  minute: number,
): OpenWindow | null {
  for (const window of hours) {
    if (window.day === day && window.open <= minute && minute < window.close) {
      return window;
    }
    const previousDay = (day + 6) % 7;
    if (
      window.day === previousDay &&
      window.close > 1440 &&
      minute + 1440 < window.close
    ) {
      return window;
    }
  }
  return null;
}

/** Open at this minute of this day? Null hours are open — unknown is not
 * shut. A minute past 1440 (an ETA that crossed midnight) is folded onto
 * the next day before checking. */
export function openAt(
  hours: OpenWindow[] | null | undefined,
  day: number,
  minute: number,
): boolean {
  if (!hours) return true;
  const foldedDay = (day + Math.floor(minute / 1440)) % 7;
  const foldedMinute = minute % 1440;
  return containing(hours, foldedDay, foldedMinute) !== null;
}

/**
 * Minutes of drinking left from this minute, or null where hours are
 * unknown. Zero means shut. This is what the last-orders margin reads.
 */
export function openFor(
  hours: OpenWindow[] | null | undefined,
  day: number,
  minute: number,
): number | null {
  if (!hours) return null;
  const foldedDay = (day + Math.floor(minute / 1440)) % 7;
  const foldedMinute = minute % 1440;
  const window = containing(hours, foldedDay, foldedMinute);
  if (!window) return 0;
  // The spill-over case: measuring from the previous day's window means the
  // minute is sitting 1440 later than the window's own clock.
  const at = window.day === foldedDay ? foldedMinute : foldedMinute + 1440;
  return window.close - at;
}

/** When the group reaches hole `index` (0-based): tee-off, plus the walk so
 * far, plus a dwell for every hole already drunk. */
export function arrivalMinute(
  teeOff: TeeOff,
  walkMinutesSoFar: number,
  index: number,
): number {
  return teeOff.minutes + Math.round(walkMinutesSoFar) + index * DWELL_MINUTES;
}
