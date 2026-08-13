"use client";

import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAction } from "@/hooks/use-action";
import { startCaddyTopupCheckout } from "@/lib/actions/billing";
import {
  CADDY_TOPUP_OFFERS,
  WHAT_A_GO_BUYS,
  WHAT_A_GO_NEEDS,
} from "@/lib/caddy/credits";
import { cn } from "@/lib/utils";

/**
 * More caddy — the sheet a spent fee gets instead of an error.
 *
 * The second of the caddy's two money doors, and deliberately the same shape
 * as the first (`components/round/green-fee-sheet.tsx`): a bottom sheet, one
 * line saying where the host stands, the ways on, a plain exit. A host who has
 * paid and used what they paid for should not meet a different *kind* of
 * screen from one who has not paid at all.
 *
 * It is a component rather than a block inside the drafting table's caddy
 * group for a reason that is enforced by `tests/unit/covenant-money.test.ts`:
 * the covenant lets a price render only in answer to a refusal, and the way to
 * hold a component to that is to let only components that *are* refusals hold
 * a price at all. With the offers in here, the group above quotes nothing.
 *
 * The free ways on are named **first** and the top-ups sit under a rule
 * beneath them. That order is the covenant's "no guilt declines" as layout:
 * the host reads what they still have before they read what more costs.
 */
export function CaddyMoreSheet({
  open,
  onOpenChange,
  courseId,
  standing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The course this fee has already filed, if there is one — the first and
   * best way on, because it is the thing they actually bought. */
  courseId?: string | null;
  /** Where the host stands, in the pipeline's own words. The line differs
   * between "you have your courses" and "your day is over", and both are
   * written where the allowance is counted rather than here. */
  standing: string;
}) {
  /**
   * Straight out to Stripe: fulfilment is the webhook's, never the client's,
   * so nothing here grants anything and a host who closes the tab mid-payment
   * has bought nothing. On the way back the drafting table reloads and the
   * allowance is read fresh from the ledger.
   *
   * Through `useAction` for the same reason `GreenFeeSheet` is — the house
   * waiting contract, the house toast for a till that would not answer, and
   * one `pending` that disables all three rungs rather than a hand-rolled
   * boolean that had to be reset on every path out.
   */
  const { run, pending } = useAction();

  function topUp(lookupKey: string) {
    run(async () => {
      const result = await startCaddyTopupCheckout(lookupKey);
      if (result.error) return { error: result.error };
      if (result.url) window.location.href = result.url;
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-2xl">
        <SheetHeader className="pb-0 text-center">
          <SheetTitle className="eyebrow text-center text-fairway">
            The caddy
          </SheetTitle>
          <SheetDescription className="font-serif text-xl text-foreground not-italic">
            Your courses are in the book
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4 pb-6">
          <p className="text-center text-xs text-muted-foreground">{standing}</p>
          {courseId ? (
            <Link
              href={`/courses/${courseId}`}
              className={cn(buttonVariants(), "mt-1 w-full")}
            >
              Open the latest one
            </Link>
          ) : null}
          <Link
            href="/courses"
            className={cn(buttonVariants({ variant: "outline" }), "w-full")}
          >
            See the whole book
          </Link>
          <p className="text-center text-[10px] text-muted-foreground">
            Changing them is free, and so is plotting one by hand.
          </p>
          {/* The one place more caddy is ever offered.
              The rule it obeys: the covenant forbids money *interrupting*,
              not money *answering*, and `tests/unit/covenant-money.test.ts`
              is what holds the difference. This appears
              only because the host asked for a course and could not have one,
              it appears once, and the free ways on are named above it rather
              than below. No count, no clock, no second ask. */}
          <div className="mt-3 border-t border-border/60 pt-3">
            <p className="text-center text-[10px] text-muted-foreground">
              Or have the caddy plan more.
            </p>
            {/* What a go is, before the price rather than after it.
                The shelf shipped without this and the shape of the confusion
                was predictable in hindsight: an undefined unit has to be
                guessed from its own name, so the name was asked to carry both
                "this produces a whole fresh card" and "the fresh one replaces
                what you have". No word does that, which is why the old one
                ("rounds") was read as a night of pub golf — the thing that
                word means everywhere else in this app. */}
            <p className="mt-1 text-center text-[10px] text-muted-foreground">
              {WHAT_A_GO_BUYS}
            </p>
            {/* And the unit's one condition, in the warning tone, before the
                prices. Everyone this sheet opens for already holds a fee —
                the till (`topupRefusal`) refuses anyone who does not — so
                this is not a gate but a fact about what is being bought:
                goes attach to the fee, they are not a cheaper way around it. */}
            <p className="mt-1 text-center text-[10px] font-semibold text-hazard">
              {WHAT_A_GO_NEEDS}
            </p>
            {/* Two rungs of the same kind of thing, ascending. It was three,
                and the odd one out bought a second course to *keep* rather
                than another go at this one — a difference the price and the
                count could not show, on a row that ran £5, £12, £9 and so did
                not sort. `CADDY_TOPUPS_ON_SALE` is what retired it; hosts who
                already bought one keep their slot. */}
            <div className="mt-2 flex gap-2">
              {CADDY_TOPUP_OFFERS.map((offer) => (
                <Button
                  key={offer.lookupKey}
                  type="button"
                  variant="outline"
                  className="h-auto flex-1 flex-col gap-0.5 py-2"
                  disabled={pending}
                  onClick={() => topUp(offer.lookupKey)}
                >
                  <span className="font-serif text-base">{offer.price}</span>
                  <span className="text-[10px] font-normal text-muted-foreground">
                    {offer.goes}
                  </span>
                </Button>
              ))}
            </div>
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              Yours to keep — these don&apos;t run out with the day.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
