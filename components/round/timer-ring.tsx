"use client";

import { useCountdown } from "@/hooks/use-countdown";
import { formatClock, isUrgent, ringFraction, spokenClock } from "@/lib/time";
import { cn } from "@/lib/utils";

const RADIUS = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The shot clock: an SVG arc draining toward the shared deadline, mm:ss in
 * the middle. One timestamp in Postgres; every phone draws the same arc.
 */
export function TimerRing({
  deadline,
  totalMs,
  className,
}: {
  deadline: Date;
  /** Full-ring duration, e.g. holeTimerMinutes * 60_000. */
  totalMs: number;
  className?: string;
}) {
  const remainingMs = useCountdown(deadline);

  const fraction = ringFraction(remainingMs, totalMs);
  const urgent = isUrgent(remainingMs);
  const spoken = spokenClock(remainingMs);
  const label = formatClock(remainingMs);

  return (
    <div
      className={cn("relative size-14 shrink-0", className)}
      role="timer"
      aria-label={spoken === null ? "Hole timer" : `${spoken} left on this hole`}
    >
      <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90">
        <circle
          cx="28"
          cy="28"
          r={RADIUS}
          fill="none"
          strokeWidth="4.5"
          className="stroke-secondary"
        />
        <circle
          cx="28"
          cy="28"
          r={RADIUS}
          fill="none"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          className={urgent ? "stroke-hazard" : "stroke-marker"}
        />
      </svg>
      <span
        className={cn(
          "tabular absolute inset-0 flex items-center justify-center font-mono text-xs font-bold",
          urgent ? "text-hazard" : "text-marker",
        )}
      >
        {label}
      </span>
    </div>
  );
}
