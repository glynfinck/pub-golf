import { Screen } from "@/components/shell/screen";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The clubhouse's bones, shown the instant the tab is tapped: head rule,
 * greeting and avatar, the active-round plate, the two door buttons, the
 * past-rounds ledger. Each tab carries its own bones (loading.tsx beside
 * its page) because sibling navigations only ever show the sibling's own
 * boundary — a shared one would sit already-mounted and never flip.
 */
export default function Loading() {
  return (
    <Screen withTabBar aria-busy>
      <div className="rule-double" aria-hidden />
      <div className="flex items-end justify-between gap-3">
        <div>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-7 w-44" />
        </div>
        <Skeleton className="size-10 shrink-0 rounded-full" />
      </div>
      <Skeleton className="h-32 w-full rounded-xl" />
      <div className="flex gap-3">
        <Skeleton className="min-h-12 flex-1 rounded-lg" />
        <Skeleton className="min-h-12 flex-1 rounded-lg" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
    </Screen>
  );
}
