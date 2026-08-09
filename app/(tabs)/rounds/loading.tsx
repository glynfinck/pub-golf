import { Screen } from "@/components/shell/screen";
import { Skeleton } from "@/components/ui/skeleton";

/** The history ledger's bones: header line, then a column of round rows. */
export default function Loading() {
  return (
    <Screen withTabBar aria-busy>
      <div>
        <Skeleton className="h-3 w-16" />
        <Skeleton className="mt-2 h-7 w-32" />
      </div>
      <div className="flex flex-col gap-px rounded-xl border border-border bg-card px-4 py-1">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-1.5 h-3 w-1/2" />
            </div>
            <Skeleton className="h-3 w-12 shrink-0" />
          </div>
        ))}
      </div>
    </Screen>
  );
}
