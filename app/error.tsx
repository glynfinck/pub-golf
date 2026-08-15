"use client";

import { Screen } from "@/components/shell/screen";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Screen>
      <div className="rule-double" aria-hidden />
      <div className="mt-10 text-center">
        <div className="eyebrow">Out of bounds</div>
        <h1 className="mt-1 font-serif text-2xl italic">A ball in the rough</h1>
        <p className="mx-auto mt-2 max-w-[36ch] text-sm text-muted-foreground">
          Something went wrong on our side. Your card is safe; every score lives
          on the server, not this screen.
        </p>
        {error.digest ? (
          <p className="tabular mt-2 font-mono text-[10px] text-muted-foreground">
            ref {error.digest}
          </p>
        ) : null}
      </div>
      <Button onClick={reset} className="mx-auto mt-4 w-full max-w-60">
        Play on
      </Button>
    </Screen>
  );
}
