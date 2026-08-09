"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { Screen } from "@/components/shell/screen";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The round's own boundary. It was a byte-identical copy of the root one,
 * which meant a failure mid-round offered "play on" and, if that failed
 * again, a dead end — the tab bar does not exist on these screens.
 *
 * A round-scoped error knows one thing the root cannot: the code. So the
 * second way out is back to the round itself, which is where a lost player
 * is trying to get to anyway.
 */
export default function RoundError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ code?: string }>();
  const code = typeof params?.code === "string" ? params.code.toUpperCase() : null;

  return (
    <Screen>
      <div className="rule-double" aria-hidden />
      <div className="mt-10 text-center">
        <div className="eyebrow">Out of bounds</div>
        <h1 className="mt-1 font-serif text-2xl italic">A ball in the rough</h1>
        <p className="mx-auto mt-2 max-w-[36ch] text-sm text-muted-foreground">
          Something went wrong on our side. Your card is safe; every score
          lives on the server, not this screen.
        </p>
        {error.digest ? (
          <p className="tabular mt-2 font-mono text-[10px] text-muted-foreground">
            ref {error.digest}
          </p>
        ) : null}
      </div>
      <div className="mx-auto mt-4 flex w-full max-w-60 flex-col gap-3">
        <Button onClick={reset} className="w-full">
          Play on
        </Button>
        {code ? (
          <Link
            href={`/round/${code}`}
            className={cn(buttonVariants({ variant: "outline" }), "w-full")}
          >
            Back to the round
          </Link>
        ) : null}
      </div>
    </Screen>
  );
}
