"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { FieldLabel } from "@/components/ui/input";
import { PendingLabel } from "@/components/ui/pending-label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import {
  BUG_AREAS,
  BUG_BODY_MAX,
  BUG_BODY_MIN,
  type BugArea,
} from "@/lib/bug-report";
import { reportBug } from "@/lib/actions/support";

/**
 * The report sheet: what went wrong, and where the player was standing when
 * it did. Everything else — build, screen, hole, phase, device — is picked up
 * without asking, because a player in a pub will not type it and it is the
 * half of a bug report that makes it reproducible.
 *
 * The report becomes an issue on a PUBLIC tracker, so the sheet says so
 * before the thumb reaches Send rather than after. What stays private is
 * everything that would identify them: the name on their card, the round they
 * were on, and above all its code — a code on a public issue is an open door
 * onto a live round (`lib/bug-report.ts` is where that redaction is proved).
 */
export function ReportBugSheet({
  open,
  onOpenChange,
  roundCode,
  hole,
  phase,
  caddySessionId,
  caddyTurnId,
  area: initialArea,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Round the player is on, when the sheet is opened from inside one. */
  roundCode?: string | null;
  hole?: number | null;
  phase?: string | null;
  /**
   * The caddy conversation this is about, when the sheet is opened from the
   * drafting table. Private to the row — the public issue carries nothing but
   * the report's own id — and it is what turns a complaint about a course into
   * a question with an answer: from here to the session, from the session to
   * its turns, from a turn's trace to what the caddy actually did.
   */
  caddySessionId?: string | null;
  /** The exact card the report is about, when the page watched it arrive.
   * Narrows the session to one turn, which is the difference between a
   * feedback loop and a search. */
  caddyTurnId?: string | null;
  /** Where the report is being filed from, so the door picks the right one and
   * the player is not asked a question the screen already answers. */
  area?: BugArea;
}) {
  const { run, pending, busy } = useAction();
  const [area, setArea] = useState<BugArea>(initialArea ?? "other");
  const [text, setText] = useState("");
  const [filed, setFiled] = useState<{
    url: string | null;
    number: number | null;
  } | null>(null);

  const said = text.trim().length;
  const tooShort = said < BUG_BODY_MIN;

  // A sent report must not still be on screen the next time the sheet opens,
  // and neither must a half-typed one the player closed on purpose.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setFiled(null);
      setText("");
      setArea(initialArea ?? "other");
    }
    onOpenChange(next);
  }

  function send() {
    run(async () => {
      const result = await reportBug({
        area,
        body: text,
        roundCode: roundCode ?? null,
        caddySessionId: caddySessionId ?? null,
        caddyTurnId: caddyTurnId ?? null,
        hole: hole ?? null,
        phase: phase ?? null,
        // Read at the tap, never in render — the route and the viewport are
        // the browser's to answer for, and the hooks rules keep both out of
        // the render path.
        route: window.location.pathname,
        viewport: `${window.innerWidth}×${window.innerHeight}`,
      });
      if (result.error) return { error: result.error };
      setFiled({
        url: result.issueUrl ?? null,
        number: result.issueNumber ?? null,
      });
    });
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-md rounded-t-2xl"
        data-testid="report-bug-sheet"
      >
        <SheetHeader className="pb-0 text-center">
          <SheetTitle
            className="eyebrow text-center text-foreground"
            style={{ textIndent: "0.2em" }}
          >
            Report a bug
          </SheetTitle>
          <SheetDescription className="text-center text-xs">
            {filed
              ? "Filed. The house is grateful."
              : "What went wrong, and what should have happened."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex max-h-[70svh] flex-col gap-3 overflow-y-auto px-4 pb-6">
          {filed ? (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
              <p className="text-sm">
                It&apos;s on the workbench. If it turns out to be the round
                you&apos;re on, carry on playing — nothing here changes a card.
              </p>
              {filed.url ? (
                <a
                  href={filed.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  data-testid="report-bug-issue-link"
                  className="inline-flex items-center gap-1.5 text-sm font-bold text-fairway"
                >
                  Issue #{filed.number}
                  <ExternalLink size={13} aria-hidden />
                </a>
              ) : (
                <p className="text-xs text-muted-foreground">
                  It&apos;s with the club secretary — the tracker will get it
                  from here.
                </p>
              )}
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </div>
          ) : (
            <>
              <div>
                <FieldLabel>Where</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                  {BUG_AREAS.map((entry) => (
                    <Chip
                      key={entry.id}
                      active={area === entry.id}
                      onClick={() => setArea(entry.id)}
                      data-testid={`report-bug-area-${entry.id}`}
                    >
                      {entry.label}
                    </Chip>
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel htmlFor="bug-body">What happened</FieldLabel>
                <Textarea
                  id="bug-body"
                  value={text}
                  maxLength={BUG_BODY_MAX}
                  onChange={(event) => setText(event.target.value)}
                  data-testid="report-bug-body"
                  placeholder="The timer ran out on hole 4 and my swigs went back to zero."
                />
                <div className="tabular mt-1 text-right font-mono text-[10px] text-muted-foreground">
                  {said}/{BUG_BODY_MAX}
                </div>
              </div>

              {/* Said before the tap, not after: the tracker is public, and a
                  player who types a phone number into it cannot take it back. */}
              <p className="text-[11px] text-muted-foreground">
                This becomes a public issue on the house&apos;s tracker. Your
                name and your round&apos;s code stay here — everything you type
                does not, so leave anything private out of it.
              </p>

              <Button
                onClick={send}
                disabled={pending || tooShort}
                data-testid="report-bug-send"
              >
                <PendingLabel
                  pending={pending}
                  busy={busy}
                  label="Send it"
                  pendingLabel="Filing"
                />
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
