import { clockTime12 } from "@/lib/time";

/**
 * When the round tees off.
 *
 * This was four chips — six, seven, eight and nine in the evening — which is
 * not a control, it is an assumption wearing one. A crawl that starts at noon
 * is an ordinary thing to want and there was no way to ask for it, and the
 * round-creation form two screens away has had a calendar and a quarter-hour
 * nudger since launch. The brief was the odd one out.
 *
 * The hour is load-bearing rather than decorative: `lib/caddy/hours.ts` reads
 * it to refuse a walk that arrives after a pub shuts, `lib/caddy/repair.ts`
 * swaps out a stop that will be dark by the time the group reaches it, and the
 * router's exact walk prunes states on it. A wrong tee-off is a card with a
 * locked door on it, so guessing one is worse than asking.
 *
 * Pure, and it takes today's weekday rather than reading a clock — same rule
 * as `lib/time.ts`, and what lets the whole of this be proved in the unit tier.
 */

/** What one nudge moves, and the ends of the day it may move between. */
export const TEE_MINUTE_STEP = 15;
export const FIRST_TEE_MINUTES = 0;
export const LAST_TEE_MINUTES = 24 * 60 - TEE_MINUTE_STEP;

export function nudgeTeeOff(current: number, delta: number): number {
  const moved = Math.round(current) + delta;
  return Math.min(LAST_TEE_MINUTES, Math.max(FIRST_TEE_MINUTES, moved));
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export interface DayChoice {
  /** 0 Sunday … 6 Saturday — what `CaddyBrief.teeOffDay` carries, and what
   * the opening-hours checks key on. */
  day: number;
  label: string;
}

/**
 * The week ahead, from whatever today is.
 *
 * Seven, because a weekday is the whole of what the hours checks need and a
 * crawl planned for Saturday is the commonest thing there is. "Tonight" is
 * gone with the evening-only chips: it was the right word when six was the
 * earliest tee available and the wrong one the moment noon became sayable.
 */
export function dayOptions(today: number | null): DayChoice[] {
  if (today == null || !Number.isInteger(today) || today < 0 || today > 6) {
    return [];
  }
  return Array.from({ length: 7 }, (_, ahead) => {
    const day = (today + ahead) % 7;
    return {
      day,
      label: ahead === 0 ? "Today" : ahead === 1 ? "Tomorrow" : WEEKDAYS[day],
    };
  });
}

/** How a chosen day reads once it is chosen. Null day is "no day named",
 * which switches every hours check off — so it says so rather than guessing. */
export function dayLabel(day: number | null, today: number | null): string {
  if (day == null) return "no day set";
  const found = dayOptions(today).find((choice) => choice.day === day);
  return found ? found.label : (WEEKDAYS[day] ?? "no day set");
}

/**
 * What the caddy will do with this hour, in the host's language rather than
 * the router's.
 *
 * Said out loud because the tee-off is the one field on the brief whose
 * consequences are invisible: it silently decides which pubs are eligible at
 * all. A host moving the dial to eleven in the morning should be told that
 * this is now a question about who is open, not a preference.
 */
export function teeOffNote(minutes: number): string {
  const hour = Math.floor((((Math.round(minutes) % 1440) + 1440) % 1440) / 60);
  if (hour < 10) {
    return "An early tee. Very little is open — the caddy will plan round whatever is.";
  }
  if (hour < 12) {
    return "Late morning, so the card is built from the doors that open early.";
  }
  if (hour < 16) {
    return "A daytime round. Plenty of pubs do not open at midday, and the caddy only picks ones that do.";
  }
  if (hour < 18) {
    return "Afternoon into evening — most doors are open by the time you reach them.";
  }
  if (hour < 21) {
    return "The usual tee. Nothing on the card will be shut when you get there.";
  }
  return "A late tee, so the caddy leaves half an hour on last orders at the closing holes.";
}

/** The tee, as one line: "First tee 12:30 PM, Saturday." */
export function teeLine(
  minutes: number,
  day: number | null,
  today: number | null,
): string {
  const when = day == null ? "" : `, ${dayLabel(day, today).toLowerCase()}`;
  return `First tee ${clockTime12(minutes)}${when}.`;
}
