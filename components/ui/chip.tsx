"use client";

import { cn } from "@/lib/utils";

export function Chip({
  active,
  className,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  // Only where the caller has not already said what this is. A chip given
  // `role="radio"` and `aria-checked` was also shipping `aria-pressed` — two
  // state attributes on one control, which is an `aria-allowed-attr`
  // violation and leaves a screen reader to pick.
  const stateless = props.role == null && props["aria-checked"] == null;
  return (
    <button
      type="button"
      aria-pressed={stateless ? active : undefined}
      className={cn(
        "min-h-11 rounded-full px-4 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
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
