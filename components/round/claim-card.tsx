"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldLabel, Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { ordinal } from "@/lib/format";
import { formatToPar } from "@/lib/utils";

/**
 * The signup funnel, disguised as keeping your scorecard: an anonymous
 * guest adds an email, confirms the emailed code, and their auth.uid() —
 * with every round on it — becomes a permanent account.
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
  const [stage, setStage] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();

  function sendCode() {
    startTransition(async () => {
      const supabase = createClient();
      const { data, error } = await supabase.auth.updateUser({ email });
      if (error) {
        toast.error(
          /already/i.test(error.message)
            ? "That email already has a locker here — sign in with it next time instead."
            : error.message,
        );
        return;
      }
      // Environments with autoconfirm apply the change instantly — no code
      // ever arrives, so don't ask for one. No router.refresh here: the
      // server would drop this card mid-celebration; state syncs on the
      // next navigation.
      if (data.user && !data.user.new_email) {
        setStage("done");
        toast.success("Card claimed — it's on your record for good.");
        return;
      }
      toast("Code sent — check your post.");
      setStage("code");
    });
  }

  function confirm() {
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "email_change",
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      setStage("done");
      toast.success("Card claimed — it's on your record for good.");
    });
  }

  return (
    <Card className="engraved gap-0 px-5 py-5">
      <div className="eyebrow text-center" style={{ textIndent: "0.2em" }}>
        {stage === "done" ? "Card claimed" : `Nice round, ${name}`}
      </div>
      <div className="mt-1 text-center font-serif text-3xl">
        {ordinal(rank)} · {formatToPar(toPar)}
      </div>
      <div className="text-center text-xs text-muted-foreground">
        {gross} swigs on the card
      </div>

      {stage === "email" ? (
        <form
          className="mt-4 flex flex-col gap-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            sendCode();
          }}
        >
          <p className="text-xs text-muted-foreground">
            Add an email and this card — and every round after it — stays on
            your record forever.
          </p>
          <div>
            <FieldLabel htmlFor="claim-email">Email</FieldLabel>
            <Input
              id="claim-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@…"
            />
          </div>
          <Button type="submit" disabled={pending || !email.trim()}>
            {pending ? "Sending…" : "Claim your card"}
          </Button>
        </form>
      ) : null}

      {stage === "code" ? (
        <form
          className="mt-4 flex flex-col gap-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            confirm();
          }}
        >
          <div>
            <FieldLabel htmlFor="claim-code">
              Confirmation code sent to {email}
            </FieldLabel>
            <Input
              id="claim-code"
              inputMode="numeric"
              maxLength={6}
              required
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, ""))
              }
              className="tabular text-center font-mono text-2xl font-bold tracking-[0.4em]"
            />
          </div>
          <Button type="submit" disabled={pending || code.length !== 6}>
            {pending ? "Confirming…" : "Confirm"}
          </Button>
        </form>
      ) : null}

      {stage === "done" ? (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          This round and your name now live in the clubhouse. See you on the
          next tee.
        </p>
      ) : null}
    </Card>
  );
}
