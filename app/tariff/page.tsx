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
import {
  CADDY_TOPUP_OFFERS,
  WHAT_A_GO_BUYS,
  WHAT_A_GO_NEEDS,
} from "@/lib/caddy/credits";
import { GREEN_FEE_PRICE, TARIFF } from "@/lib/tariff";

export const metadata = {
  title: "The tariff",
  description:
    "What Pub Golf costs: playing is free, always. The green fee, the caddy and the honesty box, priced like a pint and explained in full.",
};

/**
 * The public price list — deliberately reachable signed-out, because the
 * promise "what's free stays free" is only worth something said in public.
 * Payment processors reviewing the site land here too: pricing, refund
 * policy, and a contact all live on this one card.
 *
 * **Every rung the house sells is on this board, for every reader.** It was
 * briefly members-only — the top-ups hidden from anyone the till would refuse
 * — on the reasoning that a price you cannot pay is a confusing price. That
 * reasoning was inverted: the confusion was never the top-ups' presence, it
 * was that a bare line reading "More caddy — 3 more goes · £12" under a £12
 * green fee explained neither what a go is nor that goes ride on a fee. A
 * price list answers that by *explaining*, not by hiding — and a public
 * tariff that shows a reader less than the whole board is one they cannot
 * trust the rest of. So each entry now says what the thing actually is, in
 * the order a buyer needs it: what it does, what it costs, what it requires.
 *
 * Explaining is still not offering. The covenant keeps an *offer* to the
 * moment a host is refused something (`tests/unit/covenant-money.test.ts`),
 * and nothing on this page is a button — it is the sign on the wall, and the
 * till (`topupRefusal`) is what actually decides who may buy what.
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

/**
 * One thing the house sells, priced and then explained.
 *
 * The dot-leader rows are the board; the lines under them are what turns a
 * board into a tariff somebody can act on. Grouped rather than one-per-price
 * because the two top-up rungs are two sizes of a single article and share
 * every sentence that matters about them — printing that explanation twice
 * would imply they differ in some way the prices do not show.
 */
function TariffEntry({
  rows,
  children,
}: {
  rows: { key: string; label: React.ReactNode; value: React.ReactNode }[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-dotted border-border py-3 first:border-t-0 first:pt-1 last:pb-1">
      {rows.map((row) => (
        <DotLeaderRow key={row.key} label={row.label} value={row.value} />
      ))}
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

export default function TariffPage() {
  return (
    <Screen>
      <Masthead back={{ href: "/", label: "Clubhouse" }} />
      <ScreenHeader eyebrow="The Clubhouse" title="The tariff" />
      <p className="text-sm text-muted-foreground">
        Same as the sign on the wall, with what each thing actually is written
        under it. Checkout shows your own money — the {GREEN_FEE_PRICE} green
        fee reads {ABROAD.map((line) => line).join(", ")} abroad.
      </p>

      <Card className="gap-0 px-4 py-1">
        <TariffEntry
          rows={[
            {
              key: "free",
              label: (
                <b className="text-foreground">Playing, joining, scoring</b>
              ),
              value: <b className="text-foreground">free, always</b>,
            },
          ]}
        >
          <p>
            The game itself: a card for everyone at the table, live scores,
            penalties, the timer and the league. Joining takes a code and a
            first name — no account, and nothing to install.
          </p>
        </TariffEntry>

        <TariffEntry
          rows={[
            {
              key: "fee",
              label: "Green fee — a day of extras",
              value: GREEN_FEE_PRICE,
            },
          ]}
        >
          <p>
            A day pass for whoever is hosting. Every round you tee off inside
            the day is covered — one payment for the whole table — and covered
            rounds stay covered for good.
          </p>
          {/* The sentence with the most commercial consequence on the page,
              and the one it got wrong for a release: the day used to run from
              the charge, so a host buying on Wednesday for Saturday had a
              dead pass by Thursday. `activate_day_pass` moved the start to
              tee-off; this says so before the money rather than after it. */}
          <p>
            <b className="text-foreground">
              The day starts when you tee a round off, not when you pay
            </b>
            , so buying on Wednesday for Saturday&apos;s crawl costs you
            nothing. It then runs {DAY_PASS_HOURS} hours, with the time
            remaining always on show.
          </p>
          {/* Read off GREEN_FEE_EXTRAS, which the covenant governs: it lists
              what has shipped, never what is planned. A fee that grew an
              extra grows this line with it. */}
          <p>
            What it buys today:{" "}
            {GREEN_FEE_EXTRAS.map(
              (extra) => `${extra.title.toLowerCase()} — ${extra.detail}`,
            ).join("; ")}
            . Anything added later joins the same fee.
          </p>
        </TariffEntry>

        {/* Driven off the offers, so a retired rung leaves this board with
            it. That is the honest direction: `caddy_topup_course` cannot be
            bought any more (`startCaddyTopupCheckout` refuses it), and a
            price list quoting a price nobody can pay is worse than one that
            omits it.

            These read "a go" rather than "a round" for the reason this page
            demonstrates better than any other: three lines below, "round"
            means a night of pub golf, four times over. The £12 three-pack
            sits directly under the £12 green fee, and calling itself three
            rounds made the fee look like the worse buy at identical money. */}
        <TariffEntry
          rows={CADDY_TOPUP_OFFERS.map((offer) => ({
            key: offer.lookupKey,
            label: `More caddy — ${offer.goes}`,
            value: offer.price,
          }))}
        >
          <p>
            Extra goes at the course the caddy planned for you. {WHAT_A_GO_BUYS}
          </p>
          {/* The condition, in the warning tone, on the board as well as at
              the shelf — one constant (`WHAT_A_GO_NEEDS`), because a
              condition worded twice is two conditions the moment one of them
              is edited. This is the line that lets the £5 rung sit under the
              £12 fee without reading as the cheaper way in, and it is why
              the board can carry the rungs in public at all: `topupRefusal`
              turns a fee-less buyer away at the till, and nobody should meet
              that refusal having never been told. */}
          <p className="font-semibold text-hazard">{WHAT_A_GO_NEEDS}</p>
          <p>
            Unlike the fee&apos;s own day, these keep: goes you have bought
            never run out, so an unused one is still there next month.
          </p>
        </TariffEntry>

        <TariffEntry
          rows={[
            {
              key: "tip",
              label: "Honesty box — a tip, if you like",
              value: "from £3",
            },
          ]}
        >
          <p>
            A tip for the house and nothing else: it unlocks nothing, grants
            nothing, and changes no round. Only ever shown once a round is
            over.
          </p>
        </TariffEntry>
      </Card>

      {billingEnabled(process.env.STRIPE_SECRET_KEY) ? null : (
        <p className="text-xs text-muted-foreground">
          The taps are still being fitted; the prices above are what
          they&apos;ll cost when the bar opens.
        </p>
      )}

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
