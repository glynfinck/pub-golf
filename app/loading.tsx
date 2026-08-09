import { Screen } from "@/components/shell/screen";
import { Skeleton } from "@/components/ui/skeleton";

/** The clubhouse's bones: masthead, header line, a plate, a list, a button. */
export default function Loading() {
  return (
    <Screen aria-busy>
      <div className="rule-double" aria-hidden />
      <div>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-7 w-2/3" />
      </div>
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
      <Skeleton className="mt-auto min-h-12 w-full rounded-lg" />
    </Screen>
  );
}
