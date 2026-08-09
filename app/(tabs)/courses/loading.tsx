import { Screen } from "@/components/shell/screen";
import { Skeleton } from "@/components/ui/skeleton";

/** The course book's bones: head rule, header, your shelf, the door, the
 * curated shelf. */
export default function Loading() {
  return (
    <Screen withTabBar aria-busy>
      <div className="rule-double" aria-hidden />
      <div>
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-2 h-7 w-40" />
      </div>
      <div className="flex flex-col rounded-xl border border-border bg-card px-4 py-1">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex min-h-13 items-center gap-2">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="mt-1.5 h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="min-h-12 w-full rounded-lg" />
      <div>
        <Skeleton className="h-3 w-36" />
        <div className="mt-2 flex flex-col rounded-xl border border-border bg-card px-4 py-1">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex min-h-13 items-center gap-2">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="mt-1.5 h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
}
