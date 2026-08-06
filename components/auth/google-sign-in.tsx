"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { GoogleIcon } from "@/components/ui/google-icon";
import { createClient } from "@/lib/supabase/client";

/**
 * The only way in for a host. Guests never come through here — they join a
 * round by code and get an anonymous session (see /join).
 */
export function GoogleSignIn({ next = "/" }: { next?: string }) {
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    // On success the browser has already left for Google; only a failure to
    // start the flow lands back here.
    if (error) {
      toast.error(error.message);
      setBusy(false);
    }
  }

  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={() => void signIn()}
      data-testid="google-sign-in"
    >
      <GoogleIcon className="size-4" />
      {busy ? "Opening Google…" : "Continue with Google"}
    </Button>
  );
}
