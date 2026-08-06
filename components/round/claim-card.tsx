"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GoogleIcon } from "@/components/ui/google-icon";
import { createClient } from "@/lib/supabase/client";
import { ordinal } from "@/lib/format";
import { formatToPar } from "@/lib/utils";

/**
 * The signup funnel, disguised as keeping your scorecard: an anonymous guest
 * links a Google identity to the auth.uid() they already have, so this round
 * — and every round already on that id — becomes a permanent account.
 *
 * On success the browser leaves for Google and comes back through
 * /auth/callback, by which point the session is no longer anonymous and the
 * results page renders the claimed confirmation instead of this card.
 */
export function ClaimCard({
  name,
  rank,
  gross,
  toPar,
}: {
  name: string;
  rank: number;
  gross: number;
  toPar: number;
}) {
  const [pending, startTransition] = useTransition();

  function claim() {
    startTransition(async () => {
      const supabase = createClient();
      const next = `${location.pathname}?claimed=1`;
      const { error } = await supabase.auth.linkIdentity({
        provider: "google",
        options: {
          redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) {
        toast.error(
          /already|exists|linked/i.test(error.message)
            ? "That Google account already has a locker here — sign in with it instead."
            : error.message,
        );
      }
    });
  }

  return (
    <Card className="engraved gap-0 px-5 py-5">
      <div className="eyebrow text-center" style={{ textIndent: "0.2em" }}>
        Nice round, {name}
      </div>
      <div className="mt-1 text-center font-serif text-3xl">
        {ordinal(rank)} · {formatToPar(toPar)}
      </div>
      <div className="text-center text-xs text-muted-foreground">
        {gross} swigs on the card
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        <p className="text-xs text-muted-foreground">
          Claim this card with Google and it — along with every round after it
          — stays on your record forever.
        </p>
        <Button
          variant="outline"
          disabled={pending}
          onClick={claim}
          data-testid="claim-card"
        >
          <GoogleIcon className="size-4" />
          {pending ? "Opening Google…" : "Claim your card"}
        </Button>
      </div>
    </Card>
  );
}
