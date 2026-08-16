"use client";

import { useEffect, useState } from "react";

import {
  holdThought,
  HOLD_MS,
  NOTHING_HELD,
  type HeldThought,
} from "@/lib/caddy/thinking";

/**
 * The caddy's reasoning as one held headline — the one implementation of it.
 *
 * Both waits used to call `highlight` straight out of render, which put a new
 * line on screen the instant a sentence closed. That is correct and still
 * unreadable: dressing nine holes the caddy finishes short sentences in
 * bursts, so the row changed three times a second and none of them was up
 * long enough to finish. This paces it — every decision in `holdThought`,
 * which is pure, so what the screen says for a given stream is provable
 * without a browser and without a model.
 *
 * The house timer pattern, same as `use-countdown`: every `Date.now()` lives
 * inside a callback and the first setState is deferred to a frame, so the
 * effect body stays pure.
 */
export function useThinking(raw: string, hold = HOLD_MS): string | null {
  const [held, setHeld] = useState<HeldThought>(NOTHING_HELD);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      const { held: next, waitMs } = holdThought(held, raw, Date.now(), hold);
      // Identity, not equality: `holdThought` hands the same object back when
      // the screen should not change, so this is the render that never happens.
      if (next !== held) {
        setHeld(next);
        return;
      }
      // Something newer is waiting out the hold. Come back when it is up
      // rather than polling — and take whatever is newest *then*.
      if (waitMs !== null) timer = setTimeout(settle, waitMs);
    };
    const frame = requestAnimationFrame(settle);
    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
    // `held` belongs here: swapping a line re-runs this, which is what
    // schedules the next swap. It settles because an unchanged `held` sets no
    // state, so the deps stop moving.
  }, [held, raw, hold]);

  return held.line;
}
