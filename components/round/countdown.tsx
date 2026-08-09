"use client";

import { useCountdown } from "@/hooks/use-countdown";
import { formatClock, isUrgent, spokenClock } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * Counts down to a shared deadline. In production the deadline is
 * `rounds.hole_deadline_at` — one timestamp in Postgres that every phone
 * renders locally, so all players see the same second without any polling.
 */
export function Countdown({
  deadline,
  className,
}: {
  deadline: Date;
  className?: string;
}) {
  const remainingMs = useCountdown(deadline);
  const spoken = spokenClock(remainingMs);

  // Render a placeholder until the first client tick (hydration safety).
  if (spoken === null) {
    return (
      <span className={cn("tabular font-mono font-bold", className)}>
        --:--
      </span>
    );
  }

  return (
    <span
      className={cn(
        "tabular font-mono font-bold",
        isUrgent(remainingMs) ? "text-hazard" : "text-foreground",
        className,
      )}
      aria-label={`${spoken} left on this hole`}
    >
      {formatClock(remainingMs)}
    </span>
  );
}
