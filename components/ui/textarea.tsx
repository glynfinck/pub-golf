import * as React from "react"

import { cn } from "@/lib/utils"

// shadcn's textarea, wearing the house Input's plate (`ui/input.tsx`) so the
// two read as one field on a form — same border, same card ground, same
// focus ring, same 16px text so iOS never zooms on focus. It grows with what
// is typed (`field-sizing-content`) up to a scroll, because a bug report is
// as long as it needs to be.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content max-h-56 min-h-28 w-full min-w-0 rounded-lg border border-input bg-card px-3.5 py-2.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
