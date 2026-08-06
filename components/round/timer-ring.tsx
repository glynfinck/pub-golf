"use client";

import { useCountdown } from "@/hooks/use-countdown";
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

  const fraction =
    remainingMs === null || totalMs <= 0
      ? 1
      : Math.min(1, Math.max(0, remainingMs / totalMs));
  const totalSeconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  const urgent = totalSeconds !== null && totalSeconds <= 120;
  const label =
    totalSeconds === null
      ? "--:--"
      : `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60)
          .toString()
          .padStart(2, "0")}`;

  return (
    <div
      className={cn("relative size-14 shrink-0", className)}
      role="timer"
      aria-label={
        totalSeconds === null
          ? "Hole timer"
          : `${Math.floor(totalSeconds / 60)} minutes ${totalSeconds % 60} seconds left on this hole`
      }
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
