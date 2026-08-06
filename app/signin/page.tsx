import Link from "next/link";

import { GoogleSignIn } from "@/components/auth/google-sign-in";
import { Screen } from "@/components/shell/screen";
import { APP_NAME, TAGLINE } from "@/lib/config";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const target = next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  // gap-8 between groups against gap-2 inside them: the wordmark lockup, the
  // sign-in action and the guest escape hatch each have to read as one thing,
  // not as a stack of evenly spaced lines.
  return (
    <Screen className="justify-center gap-8">
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full border-2 border-fairway">
          <svg viewBox="0 0 28 28" className="size-9" aria-hidden fill="none">
            <line
              x1="11"
              y1="3"
              x2="11"
              y2="22"
              stroke="var(--fairway)"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path d="M 11 3.5 L 22 6.5 L 11 10.5 Z" fill="var(--marker)" />
            <ellipse
              cx="14"
              cy="23"
              rx="8"
              ry="2.6"
              stroke="var(--fairway)"
              strokeWidth="1.6"
            />
          </svg>
        </div>
        <h1 className="font-serif text-4xl tracking-[0.08em] uppercase">
          {APP_NAME}
        </h1>
        <p className="mt-1 font-serif text-sm italic text-muted-foreground">
          {TAGLINE}
        </p>
      </div>

      <div className="flex flex-col gap-2">
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
    </Screen>
  );
}
