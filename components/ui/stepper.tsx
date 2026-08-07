"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A −/+ counter sized for a thumb. The house has several of these — holes,
 * par, allowances, handicaps — and they are all the same shape: two 44px
 * targets either side of a tabular figure that never reflows as it changes.
 */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  label,
  decrementLabel,
  incrementLabel,
  format,
  disabled,
  className,
  tone = "fairway",
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  /** Used to build the button aria-labels, e.g. "breakfast balls". */
  label: string;
  decrementLabel?: string;
  incrementLabel?: string;
  /** Render the figure — defaults to the number itself. */
  format?: (value: number) => string;
  disabled?: boolean;
  className?: string;
  /** Which accent the increment carries. */
  tone?: "fairway" | "hazard";
}) {
  return (
    <div
      className={cn(
        "flex min-h-12 items-center justify-between gap-1 rounded-lg border border-input bg-card px-1.5",
        className,
      )}
    >
      <button
        type="button"
        aria-label={decrementLabel ?? `Fewer ${label}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary disabled:opacity-30"
      >
        <Minus size={15} aria-hidden />
      </button>
      <span className="tabular min-w-6 text-center font-mono text-sm font-bold">
        {format ? format(value) : value}
      </span>
      <button
        type="button"
        aria-label={incrementLabel ?? `More ${label}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-secondary disabled:opacity-30",
          tone === "hazard" ? "text-hazard" : "text-fairway",
        )}
      >
        <Plus size={15} aria-hidden />
      </button>
    </div>
  );
}
