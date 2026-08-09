import Link from "next/link";

import { Screen } from "@/components/shell/screen";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata = { title: "Lost ball" };

/**
 * The 404. It exists because the likeliest way to reach one here is a
 * mistyped round link pasted into a group chat — so the way out is the
 * code box, not just the front door.
 */
export default function NotFound() {
  return (
    <Screen>
      <div className="rule-double" aria-hidden />
      <div className="mt-10 text-center">
        <div className="eyebrow">Lost ball</div>
        <h1 className="mt-1 font-serif text-2xl italic">
          Nothing on the card here
        </h1>
        <p className="mx-auto mt-2 max-w-[36ch] text-sm text-muted-foreground">
          That link doesn&apos;t lead anywhere we know. If you were handed a
          round, the code is six characters; try it below.
        </p>
      </div>
      <div className="mx-auto mt-4 flex w-full max-w-60 flex-col gap-3">
        <Link href="/join" className={cn(buttonVariants(), "w-full")}>
          Join with a code
        </Link>
        <Link
          href="/"
          className={cn(buttonVariants({ variant: "outline" }), "w-full")}
        >
          Back to the clubhouse
        </Link>
      </div>
    </Screen>
  );
}
