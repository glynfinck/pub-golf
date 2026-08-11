"use client";

import { DotLeaderRow } from "@/components/ui/dot-leader";
import { PendingLabel } from "@/components/ui/pending-label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAction } from "@/hooks/use-action";
import { startGreenFeeCheckout } from "@/lib/actions/billing";
import { DAY_PASS_HOURS, GREEN_FEE_EXTRAS } from "@/lib/billing";
import { GREEN_FEE_PRICE } from "@/lib/tariff";

/**
 * The green fee, as a bottom sheet — the house's existing shape for a
 * decision (penalties, mulligans, managing the round). Payment does not get
 * to arrive dressed as something grander than taking a mulligan.
 *
 * One price and one dot-leader menu, not a tier table: what the fee buys is
 * said in the app's own engraving, in the app's own voice. The wallet lives
 * on Stripe's page rather than this one — hosted checkout is what keeps card
 * data out of the app entirely — so there is one door here, and the line
 * under it says what is behind it.
 *
 * The exit is plain, full-width and carries no guilt clause. A decline
 * nobody resents is a future sale.
 */
export function GreenFeeSheet({
  open,
  onOpenChange,
  onLeave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called before the page is handed to Stripe, so a caller holding
   * unsaved state (the new-round form) can park it first. */
  onLeave?: () => void;
}) {
  const { run, pending, busy } = useAction();

  function pay() {
    run(async () => {
      const result = await startGreenFeeCheckout();
      if (result.error) return { error: result.error };
      // Fulfilment is the webhook's; this is only the way out to the till.
      if (result.url) {
        onLeave?.();
        window.location.href = result.url;
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-2xl">
        <SheetHeader className="pb-0 text-center">
          <SheetTitle className="eyebrow text-center text-fairway">
            The green fee
          </SheetTitle>
          <SheetDescription className="font-serif text-xl text-foreground not-italic">
            {GREEN_FEE_PRICE} · your day at the club
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-2 px-4 pb-6">
          <div className="flex flex-col gap-1.5 pt-1">
            {GREEN_FEE_EXTRAS.map((extra) => (
              <DotLeaderRow
                key={extra.title}
                label={<span className="text-foreground">{extra.title}</span>}
                value={
                  <span className="font-mono text-[11px]">{extra.detail}</span>
                }
              />
            ))}
          </div>

          <button
            type="button"
            disabled={pending}
            onClick={pay}
            data-testid="pay-green-fee"
            className="mt-2 flex min-h-12 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-40"
          >
            <PendingLabel
              pending={pending}
              busy={busy}
              label={`Pay the green fee · ${GREEN_FEE_PRICE}`}
              pendingLabel="Opening the till"
            />
          </button>

          <p className="text-center text-[11px] text-muted-foreground">
            Apple Pay, Google Pay or card, on Stripe&apos;s own page — and in
            your own currency. One payment, no subscription: every round you
            host for the next {DAY_PASS_HOURS} hours. Rained off? Money back,
            no questions.
          </p>

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex min-h-11 items-center justify-center rounded-xl text-sm font-semibold text-muted-foreground"
          >
            Not this round
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
