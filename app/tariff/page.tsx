import Link from "next/link";

import { Masthead } from "@/components/shell/masthead";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { Card } from "@/components/ui/card";
import { DotLeaderRow } from "@/components/ui/dot-leader";
import { SUPPORT_EMAIL } from "@/lib/config";

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
export default function TariffPage() {
  return (
    <Screen>
      <Masthead back={{ href: "/", label: "Clubhouse" }} />
      <ScreenHeader eyebrow="The Clubhouse" title="The tariff" />
      <p className="text-sm text-muted-foreground">
        Same as the sign on the wall. Checkout shows your own money — the £4
        green fee reads $5, €5, C$7 or A$8 abroad.
      </p>

      <Card className="gap-2.5 px-4">
        <DotLeaderRow
          label={<b className="text-foreground">Playing, joining, scoring</b>}
          value={<b className="text-foreground">free, always</b>}
        />
        <DotLeaderRow label="Green fee — extras for one round" value="£4" />
        <DotLeaderRow label="Honesty box — a tip, if you like" value="from £3" />
      </Card>

      <p className="text-xs text-muted-foreground">
        The green fee unlocks extras for a single round — league standings
        across rounds, the printed card, your colours on the recap — one
        payment covering the whole table. Both taps are still being fitted;
        the prices above are what they&apos;ll cost when the bar opens.
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
