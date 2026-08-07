import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // bg-secondary, not shadcn's bg-muted — on the Midnight felt, muted
      // is a near-invisible one-step off the ground and the skeleton reads
      // as a blank screen rather than a loading one.
      className={cn("animate-pulse rounded-md bg-secondary", className)}
      {...props}
    />
  )
}

export { Skeleton }
