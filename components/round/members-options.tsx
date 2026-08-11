"use client";

import { useState } from "react";
import { GreenFeeSheet } from "@/components/round/green-fee-sheet";
import { PassClock } from "@/components/round/pass-clock";
import { Button } from "@/components/ui/button";
import { GREEN_FEE_EXTRAS } from "@/lib/billing";
import type { DayPass } from "@/lib/data/billing";
import { GREEN_FEE_PRICE } from "@/lib/tariff";

/**
 * Members' options, on the new-round form — the covenant's first of two
 * moments money is allowed to speak.
 *
 * Disclosure at the point of use: the extras sit inside the form as one
 * engraved group, framed as round options, priced and entirely ignorable.
 * No lock icons anywhere — a lock says "you are excluded", a tariff says
 * "this is on the menu" — and the form's own primary action is untouched
 * whether or not the fee is added, so declining costs zero taps.
 *
 * The list names what exists. When the printed pack and the colours ship
 * they join `GREEN_FEE_EXTRAS`; until then this group does not mention them,
 * because money only ever buys something real.
 */
export function MembersOptions({
  pass,
  onLeave,
}: {
  pass: DayPass | null;
  /** Called just before the trip to Stripe, so the form can park itself. */
  onLeave?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="engraved rounded-xl bg-card px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow text-fairway">Members&apos; options</span>
        {pass ? (
          <PassClock
            expiresAt={pass.expiresAt}
            className="rounded-md border border-fairway px-1.5 py-0.5 text-[9px] font-bold tracking-[0.14em] text-fairway uppercase"
          />
        ) : (
          <span className="rounded-md border border-marker px-1.5 py-0.5 text-[9px] font-bold tracking-[0.14em] text-marker uppercase">
            Green fee · {GREEN_FEE_PRICE}
          </span>
        )}
      </div>

      <ul className="mt-2 flex flex-col gap-1.5">
        {GREEN_FEE_EXTRAS.map((extra) => (
          <li key={extra.title} className="text-xs">
            <span className="font-semibold">{extra.title}</span>
            <span className="text-muted-foreground"> — {extra.detail}</span>
          </li>
        ))}
      </ul>

      {pass ? (
        <p className="mt-2.5 text-[10px] text-muted-foreground">
          Every round you tee off while the pass runs is covered, and stays
          covered once it has teed off. Extras for a new day take a new fee.
        </p>
      ) : (
        <>
          <p className="mt-2.5 text-[10px] text-muted-foreground">
            One payment covers the whole table, all day — set up as many
            rounds as you like inside it. Everything else on this page is
            free, and stays free.
          </p>
          <Button
            variant="outline"
            size="compact"
            className="mt-2.5 h-10 w-full"
            onClick={() => setOpen(true)}
            data-testid="add-green-fee"
          >
            Add the green fee
          </Button>
          <GreenFeeSheet
            open={open}
            onOpenChange={setOpen}
            onLeave={onLeave}
          />
        </>
      )}
    </div>
  );
}
