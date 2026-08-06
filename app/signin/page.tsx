"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Screen } from "@/components/shell/screen";
import { Button } from "@/components/ui/button";
import { FieldLabel, Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { APP_NAME, TAGLINE } from "@/lib/config";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { data: name.trim() ? { display_name: name.trim() } : undefined },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setStage("code");
    toast.success("Code sent — check your email.");
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <Screen className="justify-center gap-5">
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

      {stage === "email" ? (
        <form className="flex flex-col gap-4" onSubmit={sendCode}>
          <div>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              placeholder="glyn@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div>
            <FieldLabel htmlFor="name">Name on the card (first time only)</FieldLabel>
            <Input
              id="name"
              autoComplete="name"
              placeholder="Glyn"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Email me a tee-off code"}
          </Button>
        </form>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={verifyCode}>
          <div>
            <FieldLabel htmlFor="otp">
              Enter the 6-digit code sent to {email}
            </FieldLabel>
            <Input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              placeholder="123456"
              maxLength={6}
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              className="tabular text-center font-mono text-2xl font-bold tracking-[0.4em]"
            />
          </div>
          <Button type="submit" disabled={busy || code.length < 6}>
            {busy ? "Checking…" : "Tee off"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setStage("email")}
          >
            Different email
          </Button>
        </form>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Just joining a mate&apos;s round?{" "}
        <Link href="/join" className="font-bold text-fairway">
          Enter a code — no account needed
        </Link>
      </p>
    </Screen>
  );
}
