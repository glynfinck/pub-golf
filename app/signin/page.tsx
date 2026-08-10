import Link from "next/link";

import { GoogleSignIn } from "@/components/auth/google-sign-in";
import { Screen } from "@/components/shell/screen";
import { HouseMark } from "@/components/ui/house-mark";
import { safeNext, signInReason } from "@/lib/auth-paths";
import { APP_NAME } from "@/lib/config";

export const metadata = { title: "Sign in" };

/**
 * The members' entrance, and now only that.
 *
 * This screen used to be the whole front door, and it still wore the clothes:
 * the mark at full size, the tagline, a paragraph explaining what pub golf is,
 * the age notice, three legal links — with the one Google button buried in the
 * middle of them. Every one of those lines is the landing page's argument
 * (`components/landing.tsx`), which `/` has answered for a signed-out visitor
 * since Google's verifier asked it to. Printing the pitch twice is what made
 * the two URLs read as the same page, and it left the actual door the smallest
 * thing on the screen.
 *
 * So: what only this URL can do. The `next` deep link a protected screen sends
 * along — said out loud, because "your courses are behind this" is the one
 * sentence the landing page cannot write — and the error line the OAuth
 * callback bounces back to. The selling is one link away, upwards, where the
 * stranger and the reviewer both already are.
 *
 * Deliberately shaped like `/join`: centred masthead, serif heading, one thing
 * to do. They are the same fixture — two doors into the same round — and until
 * now only one of them looked it.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const target = safeNext(next);

  return (
    <Screen className="justify-center gap-6">
      <header className="text-center">
        <HouseMark className="mx-auto mb-3 size-14 rounded-xl" />
        {/* Small, but still the masthead voice — serif, uppercase,
            tracking-[0.08em], foreground ink — because that voice is what
            `scripts/brand-lockups.mjs` mirrors and this is the screen it
            reads. The scale is this page's business; the spelling is not. */}
        <p className="font-serif text-xs tracking-[0.08em] uppercase">
          {APP_NAME}
        </p>
        <h1 className="mt-4 font-serif text-3xl">Sign in</h1>
        <p className="mt-1.5 text-sm text-balance text-muted-foreground">
          {signInReason(target)}
        </p>
      </header>

      <div className="flex flex-col gap-2.5">
        <GoogleSignIn next={target} />
        {error ? (
          <p className="text-center text-xs text-hazard" role="alert">
            That sign-in didn&apos;t complete. Give it another go.
          </p>
        ) : null}
        {/* What the tap does, not what the app is. The claims match
            `/legal/privacy` and the landing page's Google section, which is
            the only reason this line is allowed to be this short. */}
        <p className="text-center text-[11px] text-muted-foreground">
          Google asks which account, then brings you straight back. Your name
          goes on the scorecard; nothing else is read.
        </p>
      </div>

      {/* The wrong-door exit, and the likely one: hosts are a minority here.
          Signing out lands on this screen too, so it stays a tap from the
          only flow that needs no account at all. */}
      <div className="rounded-xl bg-card px-4 py-3.5 text-center ring-1 ring-foreground/10">
        <p className="text-xs text-muted-foreground">
          Just joining a mate&apos;s round?
        </p>
        {/* The link on its own line rather than trailing the question: mid-
            sentence it wrapped, and half a link on the second row reads like
            two links. */}
        <Link
          href="/join"
          className="mt-1 inline-block text-sm font-bold text-fairway"
        >
          Enter a code — no account needed
        </Link>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-4 text-center text-[11px] text-muted-foreground">
        {/* Where the explaining lives now. A stranger who lands straight on
            /signin — a shared link, a bookmark — gets a way to read what the
            app is instead of a paragraph of it printed here. */}
        <p>
          New to this?{" "}
          <Link href="/" className="font-bold text-fairway">
            What {APP_NAME} is
          </Link>
        </p>
        {/* The age notice keeps its place on a public door; the kinder, longer
            version of it stays on the landing page. The tariff does not follow
            it here — the copy the processor reads is the home page's footer,
            which is one tap up via "What Pub Golf is". */}
        <p className="flex items-center justify-center gap-3">
          <span>Over-18s only</span>
          <span aria-hidden>·</span>
          <Link href="/legal/privacy" className="font-bold text-fairway">
            Privacy
          </Link>
          <span aria-hidden>·</span>
          <Link href="/legal/terms" className="font-bold text-fairway">
            Terms
          </Link>
        </p>
      </div>
    </Screen>
  );
}
