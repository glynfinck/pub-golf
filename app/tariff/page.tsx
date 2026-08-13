import Link from "next/link";

import { Masthead } from "@/components/shell/masthead";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { Card } from "@/components/ui/card";
import { DotLeaderRow } from "@/components/ui/dot-leader";
import {
  billingEnabled,
  DAY_PASS_HOURS,
  GREEN_FEE_EXTRAS,
} from "@/lib/billing";
import { SUPPORT_EMAIL } from "@/lib/config";
import { CADDY_TOPUP_OFFERS } from "@/lib/caddy/credits";
import { GREEN_FEE_PRICE, TARIFF } from "@/lib/tariff";

export const metadata = {
  title: "The tariff",
  description:
    "What Pub Golf costs: playing is free, always. The green fee and the honesty box, priced like a pint.",
};

/**
 * The public price list — deliberately reachable signed-out, because the
 * promise "what's free stays free" is only worth something said in public.
 * Payment processors reviewing the site land here too: pricing, refund
 * policy, and a contact all live on this one card.
 */
/**
 * The fee in the currencies Checkout actually presents, read off the price
 * object rather than typed out. The sentence used to name £4 — the launch
 * price — under a board rendering £12, because one was a constant and the
 * other was prose, and only one of them was updated when the caddy shipped.
 */
const ABROAD = [
  `$${TARIFF.greenFee.amounts.usd / 100}`,
  `€${TARIFF.greenFee.amounts.eur / 100}`,
  `C$${TARIFF.greenFee.amounts.cad / 100}`,
  `A$${TARIFF.greenFee.amounts.aud / 100}`,
];

export default function TariffPage() {
  return (
    <Screen>
      <Masthead back={{ href: "/", label: "Clubhouse" }} />
      <ScreenHeader eyebrow="The Clubhouse" title="The tariff" />
      <p className="text-sm text-muted-foreground">
        Same as the sign on the wall. Checkout shows your own money — the{" "}
        {GREEN_FEE_PRICE} green fee reads{" "}
        {ABROAD.map((line) => line).join(", ")} abroad.
      </p>

      <Card className="gap-2.5 px-4">
        <DotLeaderRow
          label={<b className="text-foreground">Playing, joining, scoring</b>}
          value={<b className="text-foreground">free, always</b>}
        />
        <DotLeaderRow
          label="Green fee — a day of extras"
          value={GREEN_FEE_PRICE}
        />
        {/* The top-ups are on the board because a price list that omits what
            the house sells is not one. They are never *offered* here — the
            covenant keeps an offer to the moment a host is refused something
            (`tests/unit/covenant-money.test.ts`) — but disclosure and
            marketing are different acts, and a processor reading this page
            should find every price the house can charge.

            Driven off the offers, so a retired rung leaves this board with it.
            That is the honest direction: `caddy_topup_course` cannot be bought
            any more (`startCaddyTopupCheckout` refuses it), and a price list
            that quotes a price nobody can pay is worse than one that omits it.

            These read "a go" rather than "a round" for the reason this page
            demonstrates better than any other: three lines below, "round"
            means a night of pub golf, four times over. The £12 three-pack sat
            directly under the £12 green fee calling itself three rounds, which
            made the fee look like the worse buy at identical money. */}
        {CADDY_TOPUP_OFFERS.map((offer) => (
          <DotLeaderRow
            key={offer.lookupKey}
            label={`More caddy — ${offer.goes}`}
            value={offer.price}
          />
        ))}
        <DotLeaderRow label="Honesty box — a tip, if you like" value="from £3" />
      </Card>

      <p className="text-xs text-muted-foreground">
        The green fee is a day pass, the way a real course means it: every
        round you host for {DAY_PASS_HOURS} hours is covered, one payment for
        the whole table, with the time remaining always on show. The day
        starts when you tee a round off rather than when you pay, so buying on
        Wednesday for Saturday costs you nothing. Covered rounds stay covered
        for good — the pass runs out, the rounds it granted never do. What it buys today is{" "}
        {GREEN_FEE_EXTRAS.map((extra) => extra.title.toLowerCase()).join(", ")}
        ; anything added later joins the same fee.
        {billingEnabled(process.env.STRIPE_SECRET_KEY)
          ? ""
          : " The taps are still being fitted; the prices above are what they'll cost when the bar opens."}
      </p>

      {/* The top-ups' one condition, said where their prices are. A price
          list that quotes a rung without saying it rides on the fee invites
          exactly the reading the till now refuses — the £5 line as a cheap
          way in rather than more goes on a membership. `topupRefusal` is the
          enforcement; this is the disclosure. */}
      <p className="text-xs text-muted-foreground">
        More caddy tops up a green fee rather than standing in for one: it
        adds goes for a host who has bought the fee, and those goes are yours
        to keep — they never run out with the day. On an account with no fee
        behind it, the till offers the fee first.
      </p>

      <section>
        <h3 className="eyebrow mb-2">House rules on money</h3>
        <Card className="gap-0 px-4 py-1">
          {[
            "Joining is free forever — a code and a first name gets anyone on a card.",
            "What's free stays free. New money only ever buys new things.",
            "The host pays, never the table. Nobody mid-round is shown a price.",
            "No ads, and no selling data. The app knows where you drink; that stays between us.",
            "Round numbers, no countdown timers, no tricks.",
          ].map((rule, index) => (
            <p
              key={rule}
              className={
                index > 0 ? "border-t border-border py-3 text-sm" : "py-3 text-sm"
              }
            >
              {rule}
            </p>
          ))}
        </Card>
      </section>

      <section>
        <h3 className="eyebrow mb-2">Payments, refunds, questions</h3>
        <p className="text-sm text-muted-foreground">
          Payments are handled by Stripe — Apple&nbsp;Pay, Google&nbsp;Pay, or
          card — and card numbers never touch this house. Rained off, or just
          not what you hoped? Money back, no questions: write to the club
          secretary at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="font-bold text-fairway">
            {SUPPORT_EMAIL}
          </a>
          . The slightly longer version — refunds, delivery, disputes — lives
          in{" "}
          <Link href="/small-print" className="font-bold text-fairway">
            the small print
          </Link>
          .
        </p>
      </section>

      <p className="mt-2 text-center font-serif text-xs italic text-muted-foreground">
        A card is a bit of fun, not a contract — the tariff reads the same way.
      </p>
    </Screen>
  );
}
