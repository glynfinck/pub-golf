"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Press-and-hold confirm, for the one tap that cannot be undone. The fill
 * inks across the face while the press lasts — let go early and nothing
 * happens. Friction priced to the loss: the manage sheet uses this for
 * tearing up a played round, and a plain button for an empty lobby.
 *
 * Keyboard players hold Enter or Space; the key-repeat guard keeps the
 * timer from restarting on every auto-repeat.
 */
export function HoldToConfirm({
  label,
  holdingLabel,
  holdMs = 600,
  disabled,
  onConfirm,
  className,
  "data-testid": testId,
}: {
  label: string;
  /** Copy while the press is down; defaults to the resting label. */
  holdingLabel?: string;
  holdMs?: number;
  disabled?: boolean;
  onConfirm: () => void;
  className?: string;
  "data-testid"?: string;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function start() {
    if (disabled || timer.current !== undefined) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setHolding(false);
      onConfirm();
    }, holdMs);
  }

  function cancel() {
    clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
  }

  return (
    <button
      type="button"
      disabled={disabled}
      data-testid={testId}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(event) => {
        if (event.repeat) return;
        if (event.key === "Enter" || event.key === " ") start();
      }}
      onKeyUp={cancel}
      onContextMenu={(event) => event.preventDefault()}
      className={cn(
        "relative min-h-12 w-full touch-none overflow-hidden rounded-lg bg-destructive/10 px-5 text-sm font-semibold tracking-wide text-destructive outline-none select-none focus-visible:border-destructive/40 focus-visible:ring-3 focus-visible:ring-destructive/20 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 bg-destructive/25 motion-reduce:transition-none",
          holding
            ? "w-full transition-[width] ease-linear"
            : "w-0 transition-none",
        )}
        style={holding ? { transitionDuration: `${holdMs}ms` } : undefined}
      />
      <span className="relative">
        {holding ? (holdingLabel ?? label) : label}
      </span>
    </button>
  );
}
