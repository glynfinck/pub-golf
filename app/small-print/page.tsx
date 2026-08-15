import { Masthead } from "@/components/shell/masthead";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { Card } from "@/components/ui/card";
import { SUPPORT_EMAIL } from "@/lib/config";

export const metadata = {
  title: "The small print",
  description:
    "Pub Golf's refund policy, delivery terms, and how to reach the club secretary. Shorter than most, and it means what it says.",
};

/**
 * The policies page — refunds, delivery, disputes, contact — public and
 * signed-out reachable, linked from the tariff. Payment processors want a
 * findable refund policy and support contact; players deserve one that
 * reads like the rest of the house.
 */
export default function SmallPrintPage() {
  return (
    <Screen>
      <Masthead back={{ href: "/tariff", label: "The tariff" }} />
      <ScreenHeader eyebrow="The Clubhouse" title="The small print" />
      <p className="text-sm text-muted-foreground">
        Shorter than most, and it means what it says.
      </p>

      <section>
        <h3 className="eyebrow mb-2">Refunds</h3>
        <Card className="gap-2 px-4 text-sm">
          <p>
            &ldquo;Money back, no questions&rdquo; is the policy. Written
            slightly longer:
          </p>
          <p className="text-muted-foreground">
            Ask within 30 days of a payment and it comes back in full to the
            card that paid — green fees, caddy top-ups and honesty-box tips
            alike. Rained off before the first tee? Same answer, faster. Refunds
            usually land in 5–10 working days, depending on your bank.
          </p>
        </Card>
      </section>

      <section>
        <h3 className="eyebrow mb-2">Delivery</h3>
        <Card className="gap-0 px-4 text-sm">
          <p className="text-muted-foreground">
            Everything sold here is digital and lands on your account the moment
            the payment clears — a green fee&apos;s day then starts when you tee
            a round off, not at the till, and caddy goes keep until you use
            them. Nothing ships, so nothing is late.
          </p>
        </Card>
      </section>

      <section>
        <h3 className="eyebrow mb-2">Payments and disputes</h3>
        <Card className="gap-0 px-4 text-sm">
          <p className="text-muted-foreground">
            Payments are handled by Stripe — Apple&nbsp;Pay, Google&nbsp;Pay, or
            card — and card numbers never touch this house. Statements read{" "}
            <b className="text-foreground">PUB GOLF</b>. If something looks
            wrong on yours, write first: the club secretary can fix most things
            faster than a bank dispute can.
          </p>
        </Card>
      </section>

      <section>
        <h3 className="eyebrow mb-2">Contact</h3>
        <Card className="gap-0 px-4 text-sm">
          <p className="text-muted-foreground">
            The club secretary reads everything:{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-bold text-fairway"
            >
              {SUPPORT_EMAIL}
            </a>
            . Expect a reply within two working days — usually before your next
            round.
          </p>
        </Card>
      </section>

      <p className="mt-2 text-center font-serif text-xs italic text-muted-foreground">
        A card is a bit of fun, not a contract — this page is the contract, and
        it fits on one screen.
      </p>
    </Screen>
  );
}
