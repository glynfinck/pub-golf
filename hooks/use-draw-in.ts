"use client";

import { useEffect, useState } from "react";

/**
 * A one-shot 0 → 1 over `durationMs`, for something that draws itself in.
 *
 * The house timer pattern, same as `use-countdown`: every clock reading and
 * every `setState` happens inside a frame callback, never in the effect body,
 * which is what the strict react-hooks rules are actually about.
 *
 * It runs **once per mount** and never restarts, which is deliberate — a hook
 * that re-triggered on a prop change would need to decide what counts as a
 * change, and it would decide wrong. The caller replays it by remounting
 * (`key`), so "what is worth redrawing for" stays where that question can
 * actually be answered.
 *
 * `animate: false` starts at 1 rather than jumping there in an effect, so a
 * route that should simply be *there* — an already-saved course, a player who
 * has asked for reduced motion — is drawn on the very first paint with no
 * frame of empty map in front of it.
 */
export function useDrawIn(animate: boolean, durationMs: number): number {
  const [progress, setProgress] = useState(animate ? 0 : 1);

  useEffect(() => {
    if (!animate) return;
    let frame = 0;
    let started: number | null = null;
    const step = (now: number) => {
      if (started === null) started = now;
      const elapsed = durationMs > 0 ? (now - started) / durationMs : 1;
      const next = Math.min(1, elapsed);
      setProgress(next);
      if (next < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [animate, durationMs]);

  return progress;
}
