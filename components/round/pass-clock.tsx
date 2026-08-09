"use client";

import { useCountdown } from "@/hooks/use-countdown";
import { formatTimeLeft } from "@/lib/time";

/**
 * "Covered — 16h left". A pass is always on show while it runs.
 *
 * This is the right side of the covenant's no-countdown rule, which bans
 * sales clocks — manufactured urgency *before* a purchase. A fact about
 * something already bought, shown only afterwards and only to its buyer, is
 * the opposite: it is what stops the day boundary being a surprise.
 *
 * On the sanctioned timer pattern (`useCountdown`): the fact renders
 * immediately and the figure joins it a frame later, so the clock is never
 * part of the server's HTML and hydration stays clean.
 */
export function PassClock({
  expiresAt,
  className,
}: {
  /** ISO, or null for a pass that never runs out. */
  expiresAt: string | null;
  className?: string;
}) {
  const runsOut = expiresAt === null ? null : Date.parse(expiresAt);
  const remaining = useCountdown(
    runsOut === null || Number.isNaN(runsOut) ? null : runsOut,
  );
  const left = formatTimeLeft(remaining);

  return (
    <span className={className} data-testid="pass-clock">
      Covered{left ? ` — ${left}` : ""}
    </span>
  );
}
