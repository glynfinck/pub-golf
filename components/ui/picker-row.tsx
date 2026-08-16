"use client";

import { useState } from "react";
import { Check } from "lucide-react";

import { FormRow } from "@/components/ui/form-row";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * A field whose options are too many to sit in a row.
 *
 * **Why a sheet and not more pills.** "What kind of round" has six options and
 * "what you're drinking" has seven, several of them two words long. Laid out
 * as chips they wrapped into three ragged rows apiece — which is most of what
 * made the brief a wall, and it got worse with every option added. A row plus
 * a sheet costs one extra tap and is the same height whether the field has
 * three options or thirty.
 *
 * The row reads back the answer, which is the other half of the point: the
 * brief becomes a summary you can check at a glance before spending a credit,
 * instead of six control groups you have to re-read to find out what you said.
 */
export interface PickerOption<T extends string | number> {
  id: T;
  label: string;
  /** One line under the label, where the option needs explaining. */
  note?: string;
}

export function PickerRow<T extends string | number>({
  label,
  options,
  /** Chosen ids. One-element for a single pick, any length for a multi. */
  value,
  onChange,
  /** Several answers at once — the sheet stays open, since ticking three
   * drinks is one intention and closing between each would fight it. */
  multi = false,
  /** What the row reads when nothing is chosen. */
  empty = "Any",
  /** A word under the field's name in the row. */
  note,
  /** What the sheet says under its title. */
  hint,
}: {
  label: string;
  options: readonly PickerOption<T>[];
  value: readonly T[];
  onChange: (next: T[]) => void;
  multi?: boolean;
  empty?: string;
  note?: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.filter((option) => value.includes(option.id));

  return (
    <>
      <FormRow
        label={label}
        note={note}
        value={summarise(chosen.map((option) => option.label), empty)}
        onOpen={() => setOpen(true)}
      />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{label}</SheetTitle>
            {hint ? <SheetDescription>{hint}</SheetDescription> : null}
          </SheetHeader>
          <div
            className="flex flex-col px-4 pb-[max(env(safe-area-inset-bottom),16px)]"
            role={multi ? undefined : "radiogroup"}
            aria-label={label}
          >
            {options.map((option) => {
              const on = value.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  role={multi ? "checkbox" : "radio"}
                  aria-checked={on}
                  onClick={() => {
                    if (!multi) {
                      onChange([option.id]);
                      setOpen(false);
                      return;
                    }
                    onChange(
                      on
                        ? value.filter((id) => id !== option.id)
                        : [...value, option.id],
                    );
                  }}
                  className="flex min-h-13 w-full items-center gap-3 border-b border-border/55 text-left last:border-b-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">
                      {option.label}
                    </span>
                    {option.note ? (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {option.note}
                      </span>
                    ) : null}
                  </span>
                  {/* The tick keeps its width whether or not it is drawn, so
                      the labels do not shuffle sideways as you choose. */}
                  <Check
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0 text-fairway",
                      on ? "opacity-100" : "opacity-0",
                    )}
                  />
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * What the row reads back.
 *
 * Two names then a count, because a row is one line: "Pints, halves +1" fits
 * where "Pints, halves, spirit & mixer" does not, and the count is honest
 * about what it is hiding rather than truncating a word in half.
 */
export function summarise(labels: string[], empty: string): string {
  if (labels.length === 0) return empty;
  if (labels.length <= 2) return labels.join(", ");
  return `${labels[0]}, ${labels[1]} +${labels.length - 2}`;
}
