import Link from "next/link";

import { HouseMark } from "@/components/ui/house-mark";
import { buttonVariants } from "@/components/ui/button";
import { RuleDouble } from "@/components/ui/rule";
import { APP_NAME, DESCRIPTION, SITE_URL, TAGLINE } from "@/lib/config";
import { cn } from "@/lib/utils";

/**
 * The same three facts the page states in prose — what it is called, what it
 * does, and where it lives — in the form a machine reads without having to
 * parse English.
 *
 * Google's brand verification has failed twice on exactly those points ("your
 * home page does not explain the purpose of your app", "the app name ... does
 * not match the app name on your home page"), so the page now answers them
 * four times over: the `<title>`, the `<h1>`, `og:site_name` and this. `name`
 * is the load-bearing string — it must stay spelled the way the consent
 * screen spells it, which is why it comes from APP_NAME rather than a literal.
 *
 * Deliberately no `offers`: playing is free but the green fee is not, and a
 * flat price of zero here would be the one dishonest line on the page.
 */
const SCHEMA = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: APP_NAME,
  url: SITE_URL,
  description: DESCRIPTION,
  applicationCategory: "GameApplication",
  operatingSystem: "Any",
  browserRequirements: "Requires JavaScript.",
};

/**
 * The home page a stranger lands on, and the one Google's brand verification
 * reads.
 *
 * The first attempt at this was the sign-in screen with an explanatory
 * paragraph bolted above the button, served at `/` instead of behind a 307.
 * That fixed the URL — the privacy-policy finding cleared — and Google still
 * came back with "your home page does not explain the purpose of your app"
 * and "the app name does not match the app name on your home page". Fair,
 * on reflection: a page whose whole visual argument is one big Google button
 * reads as a door, not as a description, however many words sit above it.
 *
 * So this page describes the product first and offers the way in second. The
 * things the verifier is looking for are structural rather than decorative:
 *
 *   * `{APP_NAME}` is the <h1>, spelled exactly as the consent screen spells
 *     it, and repeated in the prose rather than pronouned away.
 *   * The purpose is stated in the first paragraph, in plain words, with no
 *     house idiom a reader would have to already know. "Swigs are strokes"
 *     is charming and means nothing to somebody who has never played.
 *   * How a round works, so the page answers "what does this app do" rather
 *     than "what is this app called".
 *   * Privacy and Terms in the footer, on the page itself.
 *
 * `/signin` deliberately does NOT render this, or anything like it: it is the
 * lean door for people who already know what they came for, and this is the
 * only page that has to sell anything. It carried a small copy of the pitch
 * for one release, which is exactly how the two URLs came to read as one page
 * printed twice. Anything explaining the product belongs here, not there.
 */
export function Landing() {
  return (
    <>
      <script
        type="application/ld+json"
        // Built from our own constants, so there is no untrusted string to
        // escape — but JSON.stringify is still the only thing that goes in
        // here, never interpolated copy.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SCHEMA) }}
      />

      <RuleDouble head />

      <header className="text-center">
        <HouseMark className="mx-auto mb-4 size-20 rounded-2xl" />
        {/*
          The one place the house masthead is not set in caps, and the reason
          is literal-minded rather than aesthetic. `uppercase` is a CSS
          transform: the DOM says "Pub Golf" but the page *reads* PUB GOLF,
          and Google's identity check compares the name shown on the home page
          against the name configured on the consent screen — which is
          "Pub Golf". Two rounds of "the app name does not match" survived a
          page that had the exact string in its title, its h1 and its prose,
          which points at the rendered form being what was compared.

          The voice itself has not moved. It lives on the sign-in masthead
          (`app/signin/page.tsx`), which is what `scripts/brand-lockups.mjs`
          reads to generate the lockups, so caps are still the mark's register
          everywhere it is the mark rather than a claim about the app's name.
        */}
        <h1 className="font-serif text-4xl tracking-[0.08em]">{APP_NAME}</h1>
        <p className="mt-1 font-serif text-sm italic text-muted-foreground">
          {TAGLINE}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="eyebrow text-fairway">What {APP_NAME} is</h2>
        <p className="text-sm text-muted-foreground">
          <b className="text-foreground">
            {APP_NAME} is a free scorecard app for pub golf
          </b>
          , the pub game where a group plays a course of pubs instead of
          holes. Each pub is a hole with a named drink and a par, and the
          number of swigs you take to finish it is your score. Lowest card
          wins.
        </p>
        <p className="text-sm text-muted-foreground">
          Keeping that score on paper falls apart by the third pub. {APP_NAME}{" "}
          keeps it on everyone&apos;s phone at once, live, so the whole table
          sees the same card and nobody has to remember anything.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="eyebrow text-fairway">How a round works</h2>
        <ol className="flex flex-col gap-2.5 text-sm text-muted-foreground">
          <li className="flex gap-3">
            <span className="tabular font-mono text-xs font-bold text-marker">
              1
            </span>
            <span>
              <b className="text-foreground">One person builds the course</b>:
              pick the pubs, set a drink and a par for each. Signing in with
              Google keeps your courses and past rounds.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="tabular font-mono text-xs font-bold text-marker">
              2
            </span>
            <span>
              <b className="text-foreground">Everyone else joins with a code</b>:
              six characters, no account, no app to install. They just need
              the code and a name to put on the card.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="tabular font-mono text-xs font-bold text-marker">
              3
            </span>
            <span>
              <b className="text-foreground">Play the course</b>: tap a swig
              as you drink, and every phone updates together. Penalties,
              handicaps and the running leaderboard are all handled for you.
            </span>
          </li>
        </ol>
      </section>

      {/*
        Google's homepage requirements ask for something the sections above do
        not give, and the remediation text is the precise wording: "explain the
        purpose of your app *and how it uses Google user data you are
        requesting*". Describing the product answers half of that. This section
        is the other half, and it sits immediately above the sign-in door
        because that is the decision it informs.

        Every claim here is a claim about code in this repo and is deliberately
        the same set of claims as `/legal/privacy` — the scopes are Supabase's
        Google defaults (`openid`, `email`, `profile`; nothing is passed to
        signInWithOAuth), and "never sends email" is true because there is no
        mail server configured anywhere. If any of that changes, both pages
        change together or they start lying in different directions.
      */}
      <section className="flex flex-col gap-3">
        <h2 className="eyebrow text-fairway">
          Why {APP_NAME} asks for a Google sign-in
        </h2>
        <p className="text-sm text-muted-foreground">
          Only the person hosting signs in — everyone else joins with a code
          and no account at all. When you do sign in, {APP_NAME} asks Google
          for three things, and nothing else:
        </p>
        <ul className="flex flex-col gap-2.5 text-sm text-muted-foreground">
          <li>
            <b className="text-foreground">Your name</b> — it goes on the
            scorecard, so the table can tell whose swigs are whose. You can
            change it in Profile whenever you like.
          </li>
          <li>
            <b className="text-foreground">A Google account id</b> — so the
            courses you build and the rounds you have played are still yours
            the next time you open the app.
          </li>
          <li>
            <b className="text-foreground">Your email address</b> — Google
            returns it with the sign-in and it sits in the authentication
            database. Nothing in the app reads it, and {APP_NAME} never sends
            email: no mailing list, no notifications, no mail server at all.
          </li>
        </ul>
        <p className="text-sm text-muted-foreground">
          That is the whole request. No contacts, no calendar, no files, no
          analytics, no advertising and no third-party trackers. The{" "}
          <Link href="/legal/privacy" className="font-bold text-fairway">
            privacy policy
          </Link>{" "}
          spells out everything a round keeps.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-3">
          <Link href="/signin" className={cn(buttonVariants(), "w-full")}>
            Start a round
          </Link>
          <Link
            href="/join"
            className={cn(buttonVariants({ variant: "outline" }), "w-full")}
          >
            Join a round with a code
          </Link>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Hosting needs a Google sign-in. Joining needs nothing at all.
        </p>
      </section>

      <footer className="mt-2 flex flex-col gap-1.5 border-t border-border pt-4 text-center text-[11px] text-muted-foreground">
        <p>
          {APP_NAME}{" "}
          scores a drinking game and is for over-18s only. Know
          your limits: any hole plays just as well with a soft drink, and the card
          can&apos;t tell.
        </p>
        <p className="flex items-center justify-center gap-3">
          <Link href="/legal/privacy" className="font-bold text-fairway">
            Privacy
          </Link>
          <span aria-hidden>·</span>
          <Link href="/legal/terms" className="font-bold text-fairway">
            Terms
          </Link>
          <span aria-hidden>·</span>
          {/* main added this to the sign-in footer while this page was in
              review. The landing replaces that footer for a signed-out
              visitor, so without it the tariff would have quietly vanished
              from the home page. */}
          <Link href="/tariff" className="font-bold text-fairway">
            The tariff
          </Link>
        </p>
      </footer>
    </>
  );
}
