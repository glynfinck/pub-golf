import { Screen } from "@/components/shell/screen";
import { Skeleton } from "@/components/ui/skeleton";

/** The drafting table's bones while a saved course is fetched back onto
 * it: masthead rule, header, name field, pub search, a hole card or two. */
export default function Loading() {
  return (
    <Screen aria-busy>
      <div className="rule-double" aria-hidden />
      <div>
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-2 h-7 w-48" />
      </div>
      <div>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 min-h-12 w-full rounded-lg" />
      </div>
      <div>
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-2 min-h-12 w-full rounded-lg" />
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="mt-auto min-h-12 w-full rounded-lg" />
    </Screen>
  );
}
