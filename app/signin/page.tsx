import Link from "next/link";

import { GoogleSignIn } from "@/components/auth/google-sign-in";
import { Screen } from "@/components/shell/screen";
import { HouseMark } from "@/components/ui/house-mark";
import { APP_NAME, TAGLINE } from "@/lib/config";

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
        <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full border-2 border-fairway">
          <HouseMark className="size-10" />
        </div>
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
    </Screen>
  );
}
