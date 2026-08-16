"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { actionSettled, actionStarted } from "@/lib/action-window";
import { type Figures, withoutSettled } from "@/lib/figures";

/**
 * Optimistic figures synced behind a short debounce — the play screen's
 * swig contract, generalized for the marker's card, the handicap steppers
 * and the breakfast-ball corrector.
 *
 * The figure moves on tap; rapid taps collapse into one absolute-value
 * write (which is also what keeps out-of-order upserts from scrambling a
 * burst); a rejected write snaps the figure back and toasts. A draft entry
 * dissolves once the server echoes it, so edits from other phones show
 * through again. Keys are the caller's — include everything the write
 * depends on (player AND hole), or a roam to another hole wears the
 * wrong overlay.
 *
 * Deliberately no cleanup of in-flight timers on unmount: a scheduled
 * write is the caddy's intent, and navigating away must not lose it.
 */
export function useDraftFigures({
  server,
  write,
  delayMs = 400,
}: {
  /** The server's figure per key, rebuilt each render from props. */
  server: Figures;
  /** Sends one settled figure; returns `{ error }` to snap back and toast. */
  write: (key: string, value: number) => Promise<{ error?: string } | void>;
  delayMs?: number;
}) {
  const [held, setDraft] = useState<Figures>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  /**
   * Dissolve entries the server has caught up with.
   *
   * React's own "adjusting state when props change" pattern — compared during
   * render, re-rendered immediately without committing. It was an effect, which
   * is a setState in an effect body: the house forbids it and the linter never
   * saw it, because `hooks/` sat outside the lint script. Pruning here also
   * costs a render fewer per echo, on the hook the play screen leans on hardest.
   *
   * The pruning has to reach the *state*, not just the read: an entry the
   * server has matched and this hook still remembers would resurface the moment
   * another phone moved that figure again.
   */
  const draft = withoutSettled(held, server);
  if (draft !== held) setDraft(draft);

  function set(key: string, value: number) {
    setDraft((current) => ({ ...current, [key]: value }));
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      delete timers.current[key];
      actionStarted(Date.now());
      void write(key, value).then((result) => {
        actionSettled(Date.now());
        if (result && result.error) {
          toast.error(result.error);
          setDraft((current) => {
            const next = { ...current };
            delete next[key];
            return next;
          });
        }
      });
    }, delayMs);
  }

  function valueOf(key: string): number {
    return draft[key] ?? server[key] ?? 0;
  }

  /** True while the figure is ahead of the server — ink it marker-orange. */
  function settling(key: string): boolean {
    return draft[key] !== undefined;
  }

  return { valueOf, set, settling };
}
