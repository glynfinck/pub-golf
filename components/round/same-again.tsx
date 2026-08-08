"use client";

import { Button } from "@/components/ui/button";
import { PendingLabel } from "@/components/ui/pending-label";
import { useAction } from "@/hooks/use-action";
import { rehostRound } from "@/lib/actions/rounds";

/**
 * The 19th hole's most natural sentence, as the host's one forward action
 * on the results screen. Builds a fresh round off this one's own snapshot
 * and walks the host straight into the new lobby — the action redirects,
 * so the tap ends on the new first tee.
 */
export function SameAgain({ code }: { code: string }) {
  const { run, pending, busy } = useAction();
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        disabled={pending}
        data-testid="same-again"
        onClick={() => run(() => rehostRound(code))}
      >
        <PendingLabel
          pending={pending}
          busy={busy}
          label="Same again?"
          pendingLabel="Setting the table"
        />
      </Button>
      <p className="text-center text-[11px] text-muted-foreground">
        Same course, same rules — a fresh lobby and a new code.
      </p>
    </div>
  );
}
