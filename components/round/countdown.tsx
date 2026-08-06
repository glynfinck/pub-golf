"use client";

import { useCountdown } from "@/hooks/use-countdown";
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

  // Render a placeholder until the first client tick (hydration safety).
  if (remainingMs === null) {
    return (
      <span className={cn("tabular font-mono font-bold", className)}>
        --:--
      </span>
    );
  }

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const urgent = totalSeconds <= 120;

  return (
    <span
      className={cn(
        "tabular font-mono font-bold",
        urgent ? "text-hazard" : "text-foreground",
        className,
      )}
      aria-label={`${minutes} minutes ${seconds} seconds left on this hole`}
    >
      {minutes}:{seconds.toString().padStart(2, "0")}
    </span>
  );
}
