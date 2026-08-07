import { Screen } from "@/components/shell/screen";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The play screen's bones, so a cold round load reads as the card arriving
 * rather than anonymous grey bars: hole strip, medallion and venue line,
 * the engraved score plate, the thumb cluster. Close enough for the lobby
 * and results too — same masthead, same column.
 */
export default function Loading() {
  return (
    <Screen aria-busy>
      <div className="rule-double" aria-hidden />
      <div className="flex gap-1.5">
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} className="h-7 flex-1" />
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-2 h-6 w-2/3" />
        </div>
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-9 w-full rounded-xl" />
      <div className="mt-auto flex flex-col gap-2.5">
        <div className="flex gap-2">
          <Skeleton className="min-h-11 flex-1 rounded-xl" />
          <Skeleton className="min-h-11 flex-1 rounded-xl" />
          <Skeleton className="min-h-11 flex-1 rounded-xl" />
        </div>
        <Skeleton className="min-h-20 w-full rounded-2xl" />
      </div>
    </Screen>
  );
}
