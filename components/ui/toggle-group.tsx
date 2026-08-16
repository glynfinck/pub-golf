"use client"

import * as React from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * A segmented control: one row, equal shares, pick one.
 *
 * **Vendored, not generated.** `npx shadcn add toggle-group` is the way this
 * file is supposed to arrive, and it is how it should be re-synced — but
 * `ui.shadcn.com` is unreachable from this environment (the network policy
 * answers 403 to the registry), so it is written here against the same
 * `radix-ui` package every other generated component in this folder imports,
 * in the same `data-slot` / `cn` shape. Re-run the CLI when you can and take
 * whatever it gives you.
 *
 * **What it replaces.** A wrapping flex of `Chip`s with `role="radiogroup"`.
 * Six of those made the brief a wall: every group a different width, every
 * field a different height depending on where its options happened to wrap,
 * and a ragged right edge all the way down. A segment row has one height and
 * one edge, which is most of what "sleeker" meant.
 *
 * House customisation, exactly as `components.json` intends generated files to
 * carry: `min-h-11` on the item, because the house floor is 44px and shadcn's
 * default is smaller.
 */
function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn(
        // `overflow-hidden` is what makes the children read as one control
        // rather than as buttons that happen to touch: the outer radius clips
        // the first and last segments' square corners.
        "flex w-full items-stretch overflow-hidden rounded-lg border border-border bg-background",
        className
      )}
      {...props}
    />
  )
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        "flex min-h-11 flex-1 items-center justify-center px-2 text-xs font-semibold whitespace-nowrap text-muted-foreground transition-colors outline-none",
        "not-first:border-l not-first:border-border",
        "focus-visible:ring-3 focus-visible:ring-ring/50",
        "hover:bg-secondary",
        "data-on:bg-fairway data-on:text-primary-foreground data-on:hover:bg-fairway",
        "disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
