"use client";

import { cn } from "@/lib/utils";

export function Chip({
  active,
  className,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "min-h-10 rounded-full px-4 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active
          ? "bg-fairway text-primary-foreground"
          : "bg-secondary text-secondary-foreground hover:bg-border/60",
        className,
      )}
      {...props}
    />
  );
}

export function HazardPill({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-block rounded border border-hazard px-1.5 py-0.5 text-[9px] font-bold tracking-[0.14em] uppercase text-hazard",
        className,
      )}
      {...props}
    />
  );
}
