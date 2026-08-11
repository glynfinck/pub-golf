"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { actionSettled, actionStarted } from "@/lib/action-window";
import { BUSY_DELAY_MS, busyHoldRemaining } from "@/lib/time";

export type ActionOutcome =
  | {
      error?: string;
      /** A second line under the toast: the technical reason, where one is
       * safe to show. Actions leave it unset in production — see
       * `lib/caddy/readiness.ts`, which is what decides that for the caddy. */
      detail?: string;
    }
  | void;

/**
 * The house waiting contract around a server action.
 *
 * `pending` is true from tap to settle — disable the control and swap its
 * copy immediately; the label is the receipt for the tap. `busy` comes up
 * only once the wait has earned furniture (the putt, the masthead sweep)
 * and then holds long enough not to flash — the thresholds live in
 * `lib/time.ts` beside the shot clock's.
 *
 * A returned `{ error }` toasts hazard-red; success is the caller's to
 * show on screen, not to narrate. An accompanying `detail` becomes the
 * toast's second line, so a staging failure can say what actually broke
 * without that sentence ever being written into the player-facing copy.
 */
export function useAction() {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shownAt = useRef<number | null>(null);

  useEffect(
    () => () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
    },
    [],
  );

  function run(action: () => Promise<ActionOutcome>) {
    actionStarted(Date.now());
    clearTimeout(hideTimer.current);
    clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => {
      shownAt.current = Date.now();
      setBusy(true);
    }, BUSY_DELAY_MS);

    startTransition(async () => {
      try {
        const result = await action();
        if (result && result.error) {
          toast.error(result.error, { description: result.detail });
        }
      } finally {
        // No catch: a redirecting action throws on purpose and Next needs it.
        actionSettled(Date.now());
        clearTimeout(showTimer.current);
        const hold =
          shownAt.current === null
            ? 0
            : busyHoldRemaining(shownAt.current, Date.now());
        if (hold === 0) {
          shownAt.current = null;
          setBusy(false);
        } else {
          hideTimer.current = setTimeout(() => {
            shownAt.current = null;
            setBusy(false);
          }, hold);
        }
      }
    });
  }

  return { run, pending, busy };
}
