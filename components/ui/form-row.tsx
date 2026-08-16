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
 * **The left column is the label and nothing else.** It carried a line of
 * explanation under each field — what the answer meant, what the caddy would
 * do with it — and three things were wrong with that at once: it made some
 * rows two lines and others one, so the rhythm broke; the lines were long
 * enough to truncate mid-word, which reads as damage; and they said what the
 * value on the *right* of the same row was already saying. An option's meaning
 * belongs where the option is chosen, so it moved into the picker sheets,
 * which had a slot for it all along.
 *
 * A `warning` is the exception, and deliberately: it is not an explanation, it
 * is the field telling you the answer will not work. That earns a second line,
 * and it earns one only when there is something wrong.
 *
 * Not a shadcn primitive and not pretending to be one: this is a layout, the
 * way `Screen` is. What goes *in* the value slot is shadcn — `ToggleGroup`
 * for a short pick, `Slider` for a scale, or a row that opens a `Sheet`.
 *
 * **Inline is for numerals; words go stacked.** The value slot is capped at
 * 62% of the row, and a segmented control of four word-length labels wants
 * about 230px — so inline it overflows, and the group's own `overflow-hidden`
 * clips the last option clean off the edge where nothing can reach it. If the
 * labels are words, stack the row and let it have the full width.
 */
export function FormRow({
  label,
  /** What the field currently reads. On a stacked row it sits opposite the
   * label, so a slider says what it is set to without a second line. */
  value,
  /** Makes the whole row a button. Its own 44px comes from the frame. */
  onOpen,
  /** Put the control under the label at full width, for an input, a slider, or
   * a segmented control whose labels are words. */
  stacked = false,
  /** The answer will not work, and why. Hazard ink, full width, never
   * truncated — the one thing that may make a row taller. */
  warning,
  children,
  className,
}: {
  label: string;
  value?: string;
  onOpen?: () => void;
  stacked?: boolean;
  warning?: string;
  children?: ReactNode;
  className?: string;
}) {
  // One padding for every row, whatever it holds. A stacked row is taller
  // because its content is taller — never because it is spaced differently.
  const frame = cn(
    "flex w-full min-h-14 items-center gap-3 border-b border-border/55 py-2.5 last:border-b-0",
    className,
  );
  const name = <span className="text-sm font-semibold">{label}</span>;

  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} className={cn(frame, "text-left")}>
        {name}
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
      <div className={cn(frame, "flex-col items-stretch gap-2")}>
        <div className="flex items-baseline gap-3">
          {name}
          {value ? (
            <span className="ml-auto shrink-0 text-sm font-semibold">
              {value}
            </span>
          ) : null}
        </div>
        {children}
        {warning ? <Warning>{warning}</Warning> : null}
      </div>
    );
  }

  if (warning) {
    return (
      <div className={cn(frame, "flex-col items-stretch gap-2")}>
        <div className="flex w-full items-center gap-3">
          {name}
          <ValueSlot>{children}</ValueSlot>
        </div>
        <Warning>{warning}</Warning>
      </div>
    );
  }

  return (
    <div className={frame}>
      {name}
      <ValueSlot>{children}</ValueSlot>
    </div>
  );
}

/**
 * **The floor is why this has a `min-w`, and it is load-bearing.**
 * A `w-full` control inside a shrink-to-fit flex item has nothing to be a
 * percentage *of*, so it collapses to its own content width — which turned the
 * four-way Holes control into segments twenty-three pixels across. Forty-four
 * tall and twenty-three wide is not a tap target; it is a sliver, and it is why
 * the control could not be pressed. The floor is 180px because four 44px
 * segments plus the three hairlines between them is 179 — a slot sized to 4×44
 * exactly lands at 43.25, under the floor by the width of its own borders.
 *
 * `max-w-[62%]` is the other half: the label is what you scan down the column,
 * so a wide control may not squeeze it to nothing.
 */
function ValueSlot({ children }: { children: ReactNode }) {
  return (
    <div className="ml-auto flex max-w-[62%] min-w-45 shrink-0 justify-end">
      {children}
    </div>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-hazard">{children}</p>;
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
