import { Screen } from "@/components/shell/screen";
import { Skeleton } from "@/components/ui/skeleton";

/** The member card's bones: header, identity plate, name field, controls. */
export default function Loading() {
  return (
    <Screen withTabBar aria-busy>
      <div>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-7 w-28" />
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-4">
        <Skeleton className="size-12 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="mt-1.5 h-3 w-2/3" />
        </div>
      </div>
      <div>
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-2 min-h-12 w-full rounded-lg" />
      </div>
      <Skeleton className="min-h-12 w-full rounded-lg" />
      <Skeleton className="min-h-12 w-full rounded-lg" />
    </Screen>
  );
}
