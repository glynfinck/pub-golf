import { Screen } from "@/components/shell/screen";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <Screen aria-busy>
      <div className="rule-double" aria-hidden />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </Screen>
  );
}
