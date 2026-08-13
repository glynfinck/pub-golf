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
import { CADDY_TOPUP_OFFERS, WHAT_A_GO_NEEDS } from "@/lib/caddy/credits";
import { everBoughtGreenFee } from "@/lib/data/billing";
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

export default async function TariffPage() {
  /**
   * Whether the top-ups appear at all. The till refuses a fee-less buyer
   * (`topupRefusal`), and a board quoting a price the reader cannot pay is
   * the exact confusion that refusal exists to prevent — the £5 line under
   * the £12 line, read as a cheap way in by the one audience it will never
   * sell to. So the board shows each viewer what the house can sell *them*:
   * a member reads the full tariff, top-ups and their condition included;
   * everyone else reads the game, the fee and the tip jar, which is the
   * whole of what they can buy. A price list that omits what it will not
   * sell you is still an honest one — the other way round is not.
   */
  const member = await everBoughtGreenFee();

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
        {/* Members only — see the `member` note above. Never *offered* even
            here: the covenant keeps an offer to the moment a host is refused
            something (`tests/unit/covenant-money.test.ts`); this is the sign
            on the members' wall.

            Driven off the offers, so a retired rung leaves this board with it.
            That is the honest direction: `caddy_topup_course` cannot be bought
            any more (`startCaddyTopupCheckout` refuses it), and a price list
            that quotes a price nobody can pay is worse than one that omits it.

            These read "a go" rather than "a round" for the reason this page
            demonstrates better than any other: three lines below, "round"
            means a night of pub golf, four times over. The £12 three-pack sat
            directly under the £12 green fee calling itself three rounds, which
            made the fee look like the worse buy at identical money. */}
        {member
          ? CADDY_TOPUP_OFFERS.map((offer) => (
              <DotLeaderRow
                key={offer.lookupKey}
                label={`More caddy — ${offer.goes}`}
                value={offer.price}
              />
            ))
          : null}
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

      {/* The top-ups' one condition, said where their prices are and in the
          warning tone — so it renders exactly when the prices do, members
          only. `topupRefusal` is the enforcement; this is the warning, and
          it is the same sentence the refusal sheet shows
          (`WHAT_A_GO_NEEDS`), because a condition worded twice is two
          conditions the moment one of them is edited. */}
      {member ? (
        <>
          <p className="text-xs font-semibold text-hazard">{WHAT_A_GO_NEEDS}</p>
          <p className="text-xs text-muted-foreground">
            The goes a top-up adds are yours to keep — they never run out
            with the day.
          </p>
        </>
      ) : null}

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
