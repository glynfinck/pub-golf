"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * A scale, dragged.
 *
 * **Vendored, not generated** — see the note in `toggle-group.tsx`. The shadcn
 * registry is unreachable from this environment, so this is written against
 * the same `radix-ui` package the rest of this folder imports. Re-sync with
 * `npx shadcn add slider` when you can.
 *
 * **What it replaces.** Four `Chip`s for a quantity that is genuinely ordered
 * — Doorstep, Short, Steady, Stretch. Buttons in a row say nothing about the
 * fact that Stretch is *more* than Short; a track says it without a word, and
 * it is one gesture instead of a hunt for the right pill.
 *
 * The thumb is 22px of paint inside a 44px target — the same trick the map
 * pins and the stage bar's badge use, because the house floor is a *hit area*
 * rule, not a paint rule.
 */
function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex min-h-11 w-full touch-none items-center select-none data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1 w-full grow overflow-hidden rounded-full bg-border"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full bg-fairway"
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        className="block size-[22px] shrink-0 rounded-full border-2 border-fairway bg-card transition-[box-shadow] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
    </SliderPrimitive.Root>
  )
}

export { Slider }
