import Link from "next/link";

import { GoogleSignIn } from "@/components/auth/google-sign-in";
import { HouseMark } from "@/components/ui/house-mark";
import { APP_NAME, TAGLINE } from "@/lib/config";

/**
 * The front door, and deliberately one source for two URLs: `/` renders it
 * for a signed-out visitor and `/signin` renders it for deep links. Google's
 * verifier graded the home page and failed the redirect that used to sit
 * there, because the name, the purpose in prose and the privacy link have to
 * live at the home-page URL itself. Keeping both routes on one component is
 * what keeps that promise from quietly forking.
 */
export function FrontDoor({
  next = "/",
  error,
}: {
  /** Where Google returns to after the OAuth callback. */
  next?: string;
  /** Set when the callback bounced back with ?error. */
  error?: boolean;
}) {
  return (
    <>
      <div className="text-center">
        {/* No ring around it any more: the mark carries its own plate, and a
            squircle inside a circle is two frames arguing. */}
        <HouseMark className="mx-auto mb-4 size-20 rounded-2xl" />
        <h1 className="font-serif text-4xl tracking-[0.08em] uppercase">
          {APP_NAME}
        </h1>
        <p className="mt-1 font-serif text-sm italic text-muted-foreground">
          {TAGLINE}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {/* The purpose in prose, for the stranger and the reviewer alike.
            The tagline above is a slogan; this is the explanation. */}
        <p className="text-center text-xs text-muted-foreground">
          <b className="font-bold text-foreground">
            {APP_NAME} keeps score for pub golf:
          </b>{" "}
          nine pubs for holes, swigs for strokes, one live card the whole
          table shares. Hosts sign in to start a round; mates join with a
          code.
        </p>
        <GoogleSignIn next={next} />
        {error ? (
          <p className="text-center text-xs text-hazard" role="alert">
            That sign-in didn&apos;t complete. Give it another go.
          </p>
        ) : null}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Just joining a mate&apos;s round?{" "}
        <Link href="/join" className="font-bold text-fairway">
          Enter a code, no account needed
        </Link>
      </p>

      <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-4 text-center text-[11px] text-muted-foreground">
        <p>
          Over-18s only. Know your limits: any hole plays just as well with a
          soft drink, and the card can&apos;t tell.
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
          <Link href="/tariff" className="font-bold text-fairway">
            The tariff
          </Link>
        </p>
      </div>
    </>
  );
}
