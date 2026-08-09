import Link from "next/link";

import { HouseMark } from "@/components/ui/house-mark";
import { buttonVariants } from "@/components/ui/button";
import { RuleDouble } from "@/components/ui/rule";
import { APP_NAME, TAGLINE } from "@/lib/config";
import { cn } from "@/lib/utils";

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
 * `/signin` deliberately does NOT render this. It stays the lean one-tap
 * screen for people who already know what they came for; this is the only
 * page that has to sell anything.
 */
export function Landing() {
  return (
    <>
      <RuleDouble head />

      <header className="text-center">
        <HouseMark className="mx-auto mb-4 size-20 rounded-2xl" />
        <h1 className="font-serif text-4xl tracking-[0.08em] uppercase">
          {APP_NAME}
        </h1>
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
        </p>
      </footer>
    </>
  );
}
