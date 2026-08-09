"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recordRecapShare } from "@/lib/actions/rounds";

/**
 * The card, out of the app and into the group chat — and the one moment in
 * the phase-one funnel that leaves no trace unless something puts it there.
 *
 * `navigator.share` has to be called straight out of the tap: a share sheet
 * asked for after an `await` has lost its user gesture and Safari drops it.
 * So the count follows the share rather than leading it, which also makes it
 * honest — a sheet the host swipes away rejects, and never counts.
 *
 * The link is the results URL, whose Open Graph card renders for a crawler
 * with no session (`get_round_card` — nameless, scoreless). Anyone tapping
 * through still meets the round's own front door.
 */
export function ShareRecap({ code, name }: { code: string; name: string }) {
  const [copied, setCopied] = useState(false);

  function share() {
    const url = `${window.location.origin}/round/${code}/results`;
    const text = `${name} — the card, filed.`;
    const counted = () => void recordRecapShare(code);

    if (navigator.share) {
      navigator.share({ title: name, text, url }).then(counted, () => undefined);
      return;
    }
    navigator.clipboard.writeText(`${text} ${url}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      counted();
    }, () => undefined);
  }

  return (
    <Button variant="outline" onClick={share} data-testid="share-recap">
      <Share2 size={16} aria-hidden />
      {copied ? "Link copied" : "Share the card"}
    </Button>
  );
}
