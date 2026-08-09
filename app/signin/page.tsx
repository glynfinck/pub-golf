import Link from "next/link";

import { GoogleSignIn } from "@/components/auth/google-sign-in";
import { Screen } from "@/components/shell/screen";
import { HouseMark } from "@/components/ui/house-mark";
import { APP_NAME, TAGLINE } from "@/lib/config";

export const metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const target = next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <Screen className="justify-center gap-5">
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
        <p className="text-center text-xs text-muted-foreground">
          Sign in to keep a card and start rounds. It takes one tap.
        </p>
        <GoogleSignIn next={target} />
        {error ? (
          <p className="text-center text-xs text-hazard" role="alert">
            That sign-in didn&apos;t complete. Give it another go.
          </p>
        ) : null}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Just joining a mate&apos;s round?{" "}
        <Link href="/join" className="font-bold text-fairway">
          Enter a code — no account needed
        </Link>
      </p>

      {/* The app scores a drinking game and had never once said so. It says
          it here, where every host passes, and in the rules sheet where every
          player does. */}
      <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-4 text-center text-[11px] text-muted-foreground">
        <p>
          Over-18s only. Know your limits — any hole plays just as well with a
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
        </p>
      </div>
    </Screen>
  );
}
