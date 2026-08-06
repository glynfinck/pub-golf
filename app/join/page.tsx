"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { Screen } from "@/components/shell/screen";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldLabel, Input } from "@/components/ui/input";
import { joinRound } from "@/lib/actions/rounds";
import { createClient } from "@/lib/supabase/client";

const CODE_LENGTH = 6;

interface Preview {
  name: string;
  status: string;
  hole_count: number;
  par: number;
  player_count: number;
  host_name: string | null;
}

function JoinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState(
    (searchParams.get("code") ?? "").toUpperCase().slice(0, CODE_LENGTH),
  );
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  // Live round preview once six characters are in; while the code is
  // short the stale preview is simply not rendered.
  useEffect(() => {
    if (code.length < CODE_LENGTH) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .rpc("get_round_preview", { join_code: code })
      .then(({ data }) => {
        if (!cancelled) setPreview(data?.[0] ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (code.length < CODE_LENGTH) {
      toast.error("The round code is six characters.");
      return;
    }
    if (!name.trim()) {
      toast.error("Put a name on the card first.");
      return;
    }
    setBusy(true);
    const supabase = createClient();

    // Guests play without an account: an anonymous session gives RLS an
    // auth.uid() and can be upgraded to a real account later.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      const { error } = await supabase.auth.signInAnonymously({
        options: { data: { display_name: name.trim() } },
      });
      if (error) {
        setBusy(false);
        toast.error(error.message);
        return;
      }
    }

    const result = await joinRound(code, name);
    setBusy(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    router.push(`/round/${result.code}`);
  }

  return (
    <Screen className="justify-center gap-5">
      <div className="text-center">
        <div className="eyebrow text-fairway">You&apos;re invited</div>
        <h1 className="mt-1 font-serif text-3xl">Join a round</h1>
      </div>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div>
          <FieldLabel htmlFor="code" className="text-center">
            Round code
          </FieldLabel>
          <Input
            id="code"
            value={code}
            onChange={(event) =>
              setCode(
                event.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "")
                  .slice(0, CODE_LENGTH),
              )
            }
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="GLYN29"
            className="tabular text-center font-mono text-2xl font-bold tracking-[0.4em]"
          />
        </div>
        <div>
          <FieldLabel htmlFor="name" className="text-center">
            Name on the card
          </FieldLabel>
          <Input
            id="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            placeholder="Jamie"
            className="text-center"
          />
        </div>

        {preview && code.length === CODE_LENGTH ? (
          <Card className="gap-0 px-4 text-center">
            <div className="font-serif text-lg">{preview.name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {preview.hole_count} holes · Par {preview.par} ·{" "}
              {preview.status === "live" ? "already live" : "in the lobby"}
            </div>
            <div className="mt-2 text-xs">
              <b>
                {preview.player_count}{" "}
                {preview.player_count === 1 ? "player" : "players"} in
              </b>
              {preview.host_name ? ` · hosted by ${preview.host_name}` : null}
            </div>
          </Card>
        ) : null}

        <Button type="submit" disabled={busy}>
          {busy ? "Taking you to the tee…" : "Join the round"}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        No account needed — sign-in is for hosts.
      </p>
    </Screen>
  );
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinForm />
    </Suspense>
  );
}
