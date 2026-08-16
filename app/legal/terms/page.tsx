import { CONTACT_EMAIL, LegalHeader, Points, Section } from "@/app/legal/parts";
import { APP_NAME } from "@/lib/config";

export const metadata = {
  title: "Terms",
  description: `The house rules for using ${APP_NAME} itself.`,
};

export default function TermsPage() {
  return (
    <>
      <LegalHeader
        eyebrow="House papers"
        title="Terms"
        standfirst="The rules for the app, as opposed to the rules for the round."
      />

      <Section heading="What this is">
        <p>
          {APP_NAME} keeps score for a pub golf round. It is a personal project
          rather than a company. Playing, joining and scoring are free and stay
          free; a host can pay for extras if they want them, and nobody at the
          table is ever asked for anything.
        </p>
        <p>
          Using it means accepting what is on this page and in the{" "}
          <a href="/legal/privacy">privacy notice</a>.
        </p>
      </Section>

      <Section heading="If you buy something">
        <p>
          There are three things a host can pay for, all of them one-off and
          none of them a subscription: the <b>green fee</b>, a day pass covering
          every round you host once you tee one off; <b>more caddy</b>, extra
          goes at the course your fee planned — a top-up rides on a green fee,
          never stands in for one, and the goes it adds don&apos;t run out; and
          the <b>honesty box</b>, which is a tip and buys nothing.{" "}
          <a href="/tariff">The tariff</a> lists what the house can sell you —
          the top-ups join it once a fee is on your account — and every price is
          shown again at the till before you pay.
        </p>
        <p>
          Payment goes through <b>Stripe</b>, on Stripe&apos;s own page — card
          numbers never reach this app. What you buy is granted by Stripe
          telling us the payment went through, so closing the tab mid-payment
          buys nothing and charges nothing.
        </p>
        <p>
          Rounds already covered stay covered: a pass runs out, the rounds it
          granted do not. Refunds, delivery and disputes are in{" "}
          <a href="/small-print">the small print</a>, and the short version is
          money back, no questions.
        </p>
      </Section>

      <Section heading="You need to be 18 or over">
        <p>
          This app scores a drinking game.{" "}
          <b>Do not use it if you are under 18</b>, or if you are under the
          legal drinking age wherever you are, whichever is higher.
        </p>
      </Section>

      <Section heading="Drink is your call, not the app's">
        <p>
          The scorecard counts swigs. It has no idea what is in the glass and it
          never asks.{" "}
          <b>
            Any hole can be played with a soft drink and the card cannot tell
            the difference
          </b>
          . Whoever is holding the phone does not decide what you drink.
        </p>
        <Points>
          <li>Know your limits, and stop when you reach them.</li>
          <li>
            The timer is a suggestion. Nothing bad happens if it runs out.
          </li>
          <li>
            Never drive. Plan how everyone is getting home before the first tee.
          </li>
          <li>
            Advice on drinking and how to get help is at{" "}
            <a
              href="https://www.drinkaware.co.uk"
              target="_blank"
              rel="noreferrer noopener"
            >
              drinkaware.co.uk
            </a>
            .
          </li>
        </Points>
        <p>
          You are responsible for what you and your group actually do on a night
          out. A scorecard on a phone is not, and cannot be, in charge of that.
        </p>
      </Section>

      <Section heading="Forfeits are a joke">
        <p>
          The app suggests a forfeit for whoever comes last, and the round can
          carry any local rules a group invents. None of it is enforceable by
          anyone, least of all us. <b>A card is a bit of fun, not a contract</b>
          , and no rule agreed at a first tee makes anybody do something unsafe,
          illegal or humiliating.
        </p>
      </Section>

      <Section heading="Playing nicely">
        <p>Two things worth saying plainly, since names appear on cards:</p>
        <Points>
          <li>
            Don&apos;t put someone on a card under a name they would not want in
            a group chat.
          </li>
          <li>
            Don&apos;t use the app to harass anyone. A host or caddy can strike
            a seat from a round; we can remove rounds and accounts entirely.
          </li>
        </Points>
      </Section>

      <Section heading="No promises about uptime">
        <p>
          {APP_NAME} is provided as-is. It may be unavailable, it may lose a
          score, and it may change or disappear without notice. To the extent
          the law allows, there is no warranty and no liability for anything
          that follows from using it; a hobby project cannot underwrite your
          evening.
        </p>
        <p>Nothing here limits liability that cannot legally be limited.</p>
      </Section>

      <Section heading="The rest">
        <p>
          These terms are governed by the law of England and Wales. If a part of
          this page turns out to be unenforceable, the remainder still stands.
          Changes are dated at the top.
        </p>
        <p>
          Questions: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </Section>
    </>
  );
}
