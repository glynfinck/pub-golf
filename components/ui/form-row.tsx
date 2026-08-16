"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * One row, and every field in the brief is one.
 *
 * **The rule: the row is the constant, the value slot is what varies.** The
 * brief had six wrapping chip groups, each a different width and a different
 * height depending on where its own options happened to wrap — so the right
 * edge was ragged all the way down and no two fields lined up. A row with a
 * label on the left and a value on the right lines every field up by
 * construction, and the eye stops re-learning the layout at each one.
 *
 * Not a shadcn primitive and not pretending to be one: this is a layout, the
 * way `Screen` is. What goes *in* the value slot is shadcn — `ToggleGroup`
 * for a short pick, `Slider` for a scale, `Stepper` for a count, or
 * `RowValue` opening a `Sheet` for a list too long to sit in a row.
 *
 * Three shapes, one rhythm:
 *
 *   `<FormRow label="Holes"><ToggleGroup …/></FormRow>`   inline control
 *   `<FormRow label="Kind of round" onOpen={…} value="Steady" />`  opens a sheet
 *   `<FormRow label="Where" stacked>…</FormRow>`  full-width, for an Input
 *
 * **Inline is for numerals; words go stacked.** The value slot is capped at
 * 62% of the row, and a segmented control of four word-length labels wants
 * about 230px — so inline it overflows, and the group's own `overflow-hidden`
 * clips the last option clean off the edge where nothing can reach it. If the
 * labels are words, stack the row and let it have the full width.
 */
export function FormRow({
  label,
  /** What the field currently reads, where the control is elsewhere. */
  value,
  /** Makes the whole row a button. Its own 44px comes from the frame. */
  onOpen,
  /** Put the control under the label at full width, for an input or a slider
   * that has nowhere useful to go in the value slot. */
  stacked = false,
  /** A word under the label. Kept to one line — this is a row, not a panel. */
  note,
  children,
  className,
}: {
  label: string;
  value?: string;
  onOpen?: () => void;
  stacked?: boolean;
  note?: string;
  children?: ReactNode;
  className?: string;
}) {
  const head = (
    <div className="flex min-w-0 flex-1 flex-col text-left">
      <span className="text-sm font-semibold">{label}</span>
      {note ? (
        <span className="truncate text-[11px] text-muted-foreground">
          {note}
        </span>
      ) : null}
    </div>
  );

  // The row's own hairline, not a border on a wrapper: a divider between rows
  // has to disappear on the last one, and `not-last` says so once here rather
  // than at every call site.
  const frame = cn(
    "flex w-full min-h-14 items-center gap-3 border-b border-border/55 py-1.5 not-last:border-b",
    "last:border-b-0",
    className,
  );

  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} className={cn(frame, "text-left")}>
        {head}
        <span className="ml-auto flex max-w-[55%] shrink-0 items-center gap-1.5 text-sm">
          <span className="truncate font-semibold">{value}</span>
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </span>
      </button>
    );
  }

  if (stacked) {
    return (
      <div className={cn(frame, "flex-col items-stretch gap-1.5 py-2.5")}>
        {head}
        {children}
      </div>
    );
  }

  return (
    <div className={frame}>
      {head}
      {/*
       * **The floor is why this has a `min-w`, and it is load-bearing.**
       * A `w-full` control inside a shrink-to-fit flex item has nothing to be
       * a percentage *of*, so it collapses to its own content width — which
       * turned the four-way Holes control into segments twenty-three pixels
       * across. Forty-four tall and twenty-three wide is not a tap target; it
       * is a sliver, and it is why the control could not be pressed. The
       * floor is 180px because four 44px segments plus the three hairlines
       * between them is 179 — a slot sized to 4×44 exactly lands at 43.25,
       * which is under the floor by the width of its own borders.
       *
       * `max-w-[62%]` is the other half: the label is what you scan down the
       * column, so a wide control may not squeeze it to nothing.
       */}
      <div className="ml-auto flex min-w-45 max-w-[62%] shrink-0 justify-end">
        {children}
      </div>
    </div>
  );
}

/** The group a set of rows lives in, so the hairlines meet the same edges. */
export function FormRows({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex flex-col", className)}>{children}</div>;
}
