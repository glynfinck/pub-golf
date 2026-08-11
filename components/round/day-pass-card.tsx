import Link from "next/link";
import { PassClock } from "@/components/round/pass-clock";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { DayPass } from "@/lib/data/billing";
import { cn } from "@/lib/utils";

/**
 * The pass on the Clubhouse, while it runs.
 *
 * A green fee is a day, and a day the buyer cannot see the end of is a day
 * they will feel cheated by. So the time left is always on show — and only
 * to the person who bought it, on their own screen, after they bought it.
 * Nothing about this card asks for anything.
 */
export function DayPassCard({ pass }: { pass: DayPass }) {
  return (
    <Card
      className="gap-0 border-l-4 border-l-fairway px-4"
      data-testid="day-pass-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow text-fairway">Green fee</span>
        <PassClock
          expiresAt={pass.expiresAt}
          className="tabular font-mono text-xs text-muted-foreground"
        />
      </div>
      {/* What it actually buys, which is not what this said yesterday.
          "As many courses as you like" was written before a fee bought one,
          and a pass card promising more than the pipeline gives is worse than
          no card at all — it is the app telling you something it will then
          refuse. */}
      <p className="mt-1.5 text-xs text-muted-foreground">
        Your course is the caddy&apos;s to plan, and yours to keep — change it
        whenever, or tear it out and it will plan another. A new day takes a
        new fee.
      </p>
      <Link
        href="/courses/new"
        className={cn(
          buttonVariants({ variant: "outline" }),
          "mt-3 w-full",
        )}
      >
        Plan a course
      </Link>
    </Card>
  );
}
