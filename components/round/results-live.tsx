"use client";

import { useLiveRound } from "@/components/round/use-live-round";
import { Button } from "@/components/ui/button";
import { PendingLabel } from "@/components/ui/pending-label";
import { useAction } from "@/hooks/use-action";
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
  const { run, pending, busy } = useAction();
  return (
    <Button
      variant="outline"
      disabled={pending}
      data-testid="reopen-round"
      onClick={() => run(() => reopenHole(code, lastHole))}
    >
      <PendingLabel
        pending={pending}
        busy={busy}
        label="Reopen the last hole"
        pendingLabel="Reopening the last hole"
      />
    </Button>
  );
}
