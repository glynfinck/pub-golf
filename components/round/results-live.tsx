"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useLiveRound } from "@/components/round/use-live-round";
import { Button } from "@/components/ui/button";
import { reopenHole } from "@/lib/actions/rounds";

/** Keeps the results page live — if the caddy reopens the round or edits
 * a card, everyone's screen follows. */
export function ResultsLive({ roundId }: { roundId: string }) {
  useLiveRound(roundId);
  return null;
}

/** Officials can un-file the card and put the last hole back in play. */
export function ReopenRound({
  code,
  lastHole,
}: {
  code: string;
  lastHole: number;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      data-testid="reopen-round"
      onClick={() =>
        startTransition(async () => {
          const result = await reopenHole(code, lastHole);
          if (result.error) toast.error(result.error);
        })
      }
    >
      {pending ? "Reopening…" : "Reopen the last hole"}
    </Button>
  );
}
