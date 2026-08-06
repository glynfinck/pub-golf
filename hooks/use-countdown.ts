"use client";

import { useEffect, useState } from "react";

/**
 * Milliseconds remaining until a shared deadline, or null before the first
 * client tick (render a placeholder — this is what keeps hydration clean).
 *
 * The house timer pattern: all Date.now() lives inside the effect, and the
 * first setState is deferred to a frame so the effect body stays pure.
 */
export function useCountdown(deadline: Date | number | null) {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const deadlineMs =
    deadline === null
      ? null
      : typeof deadline === "number"
        ? deadline
        : deadline.getTime();

  useEffect(() => {
    if (deadlineMs === null) return;
    let interval: ReturnType<typeof setInterval> | undefined;
    const tick = () => setRemainingMs(Math.max(0, deadlineMs - Date.now()));
    const frame = requestAnimationFrame(() => {
      tick();
      interval = setInterval(tick, 250);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (interval) clearInterval(interval);
    };
  }, [deadlineMs]);

  return deadlineMs === null ? null : remainingMs;
}
