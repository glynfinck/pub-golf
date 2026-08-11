"use client";

import { useState } from "react";
import { Sparkle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { FieldLabel, Input } from "@/components/ui/input";
import { PendingLabel } from "@/components/ui/pending-label";
import { Putt } from "@/components/ui/putt";
import { useAction } from "@/hooks/use-action";
import {
  DEFAULT_HOLES,
  DEFAULT_STRETCH,
  HOLE_CHOICES,
  NOTE_MAX,
  PARTICULARS,
  STRETCH_CHOICES,
  VIBES,
  WHERE_MAX,
  stretchMeaning,
  type ParticularId,
  type VibeId,
} from "@/lib/caddy/brief";
import { askTheCaddy, planCourse } from "@/lib/actions/caddy";
import type { PlannedCourse } from "@/lib/caddy/plan";
import { GREEN_FEE_PRICE } from "@/lib/tariff";
import { cn } from "@/lib/utils";

/**
 * The caddy, as one members' group on the drafting table.
 *
 * There is no separate planner and no second route: the builder opens exactly
 * as it always has, and this sits above the free search. Unbought, unkeyed or
 * billing off, the whole group is absent and the builder is the one that ships
 * — which is the covenant's "what's free stays free", expressed as layout
 * rather than as a promise.
 *
 * The group owns the brief, the wait and the caddy's own two verbs. The card
 * it produces belongs to the builder, because a caddy-planned course is a
 * draft on the same table as a hand-plotted one and every edit is the same.
 */
export function CaddyGroup({
  hasPass,
  onCourse,
  onSession,
  className,
}: {
  /** A live green fee on this host. The form is identical either way — only
   * its last row changes, because the ask belongs after the investment. */
  hasPass: boolean;
  /** A card arrived. The builder takes it from here. */
  onCourse: (course: PlannedCourse, changed: number[]) => void;
  /** The session behind the card, so the builder can close it on save. */
  onSession: (sessionId: string | null) => void;
  className?: string;
}) {
  const { run, pending, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ask, setAsk] = useState("");

  const [where, setWhere] = useState("");
  const [holes, setHoles] = useState<number>(DEFAULT_HOLES);
  const [vibe, setVibe] = useState<VibeId>("traditional");
  const [particulars, setParticulars] = useState<ParticularId[]>([]);
  const [note, setNote] = useState("");
  const [stretch, setStretch] = useState<number>(DEFAULT_STRETCH);

  const meaning = VIBES.find((entry) => entry.id === vibe)?.meaning ?? "";
  const stretchNote = stretchMeaning(stretch);

  function plan() {
    run(async () => {
      const result = await planCourse({
        where,
        holes,
        vibe,
        particulars,
        note,
        stretch,
        startVenueId: null,
        finishVenueId: null,
      });
      if (result.error) return { error: result.error, detail: result.detail };
      if (result.course && result.sessionId) {
        setSessionId(result.sessionId);
        onSession(result.sessionId);
        onCourse(result.course, []);
      }
      return {};
    });
  }

  function say(input: { ask?: string; roll?: boolean }) {
    if (!sessionId) return;
    run(async () => {
      const result = await askTheCaddy({ sessionId, ...input });
      if (result.error) return { error: result.error, detail: result.detail };
      if (result.course) onCourse(result.course, result.changed ?? []);
      setAsk("");
      return {};
    });
  }

  // ——— The wait. Narrated, never spun: the line names the stage the
  // pipeline is actually in, and the Putt is the house's own busy animation.
  if (pending) {
    return (
      <div
        className={cn(
          "engraved flex flex-col items-center gap-3 rounded-xl bg-card px-4 py-6",
          className,
        )}
        aria-live="polite"
      >
        <Putt />
        <div className="text-center font-serif text-lg leading-tight text-balance">
          {sessionId ? "The caddy’s thinking" : "The caddy’s walking the patch"}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {sessionId ? "Won’t be a moment." : "About twenty seconds."}
        </p>
      </div>
    );
  }

  // ——— On the table: the caddy's two verbs, once a card exists. No count
  // anywhere — the caddy is not rationed on screen.
  if (sessionId) {
    return (
      <div
        className={cn("engraved flex flex-col gap-2.5 rounded-xl bg-card px-4 py-3.5", className)}
      >
        <span className="eyebrow text-fairway">The caddy</span>
        <div>
          <FieldLabel htmlFor="caddy-ask">Tell the caddy</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              id="caddy-ask"
              value={ask}
              onChange={(event) => setAsk(event.target.value.slice(0, 200))}
              placeholder="More gardens in the back half"
            />
            <Button
              size="compact"
              variant="outline"
              className="h-12 shrink-0"
              disabled={!ask.trim() || busy}
              onClick={() => say({ ask: ask.trim() })}
            >
              Ask
            </Button>
          </div>
        </div>
        <Button
          variant="outline"
          size="compact"
          className="h-11 w-full"
          disabled={busy}
          onClick={() => say({ roll: true })}
        >
          Roll a fresh card
        </Button>
        <p className="text-[10px] text-muted-foreground">
          Ask as often as you like — it&apos;s the same patch, so the caddy is
          quick about it. Every pub is one that&apos;s really there; swap any of
          them below.
        </p>
      </div>
    );
  }

  // ——— Collapsed: one line on the menu, priced and entirely ignorable.
  if (!open) {
    return (
      <div
        className={cn("engraved flex flex-col gap-2 rounded-xl bg-card px-4 py-3.5", className)}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow text-fairway">Members</span>
          <span
            className={cn(
              "rounded-md border px-1.5 py-0.5 text-[9px] font-bold tracking-[0.14em] uppercase",
              hasPass ? "border-fairway text-fairway" : "border-marker text-marker",
            )}
          >
            {hasPass ? "Covered" : `Green fee · ${GREEN_FEE_PRICE}`}
          </span>
        </div>
        <div className="font-serif text-base leading-tight">
          Let the caddy plan it
        </div>
        <p className="text-[11px] text-muted-foreground">
          A routed course from any patch of town — pubs, pars, drinks and
          hazards, ready in about twenty seconds. Everything below stays free.
        </p>
        <Button
          variant="outline"
          size="compact"
          className="mt-1 h-11 w-full"
          onClick={() => setOpen(true)}
          data-testid="open-caddy"
        >
          <Sparkle aria-hidden /> Plan the round
        </Button>
      </div>
    );
  }

  // ——— The brief. One screen, defaults everywhere a default is honest.
  return (
    <div
      className={cn("engraved flex flex-col gap-3 rounded-xl bg-card px-4 py-3.5", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow text-fairway">Let the caddy plan it</span>
        <span
          className={cn(
            "rounded-md border px-1.5 py-0.5 text-[9px] font-bold tracking-[0.14em] uppercase",
            hasPass ? "border-fairway text-fairway" : "border-marker text-marker",
          )}
        >
          {hasPass ? "Covered" : `Green fee · ${GREEN_FEE_PRICE}`}
        </span>
      </div>
      <div className="font-serif text-lg leading-tight text-balance">
        Your round, planned in twenty seconds
      </div>

      <div>
        <FieldLabel htmlFor="caddy-where">Where</FieldLabel>
        <Input
          id="caddy-where"
          value={where}
          onChange={(event) => setWhere(event.target.value.slice(0, WHERE_MAX))}
          placeholder="Shoreditch, London"
        />
        <p className="mt-1 text-[10px] text-muted-foreground">
          A neighbourhood, a street, a town.
        </p>
      </div>

      <div>
        <FieldLabel htmlFor="caddy-holes">Holes</FieldLabel>
        <div className="flex flex-wrap gap-1.5" id="caddy-holes" role="radiogroup" aria-label="Holes">
          {HOLE_CHOICES.map((count) => (
            <Chip
              key={count}
              role="radio"
              aria-checked={holes === count}
              active={holes === count}
              onClick={() => setHoles(count)}
            >
              {count}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel htmlFor="caddy-vibe">What kind of round</FieldLabel>
        <div className="flex flex-wrap gap-1.5" id="caddy-vibe" role="radiogroup" aria-label="What kind of round">
          {VIBES.map((entry) => (
            <Chip
              key={entry.id}
              role="radio"
              aria-checked={vibe === entry.id}
              active={vibe === entry.id}
              onClick={() => setVibe(entry.id)}
            >
              {entry.label}
            </Chip>
          ))}
        </div>
        <p className="mt-1 font-serif text-[11px] italic text-muted-foreground">
          {meaning}
        </p>
      </div>

      <div>
        <FieldLabel htmlFor="caddy-stretch">How far apart</FieldLabel>
        <div
          className="flex flex-wrap gap-1.5"
          id="caddy-stretch"
          role="radiogroup"
          aria-label="How far apart"
        >
          {STRETCH_CHOICES.map((entry) => (
            <Chip
              key={entry.id}
              role="radio"
              aria-checked={stretch === entry.id}
              active={stretch === entry.id}
              onClick={() => setStretch(entry.id)}
            >
              {entry.label}
            </Chip>
          ))}
        </div>
        <p className="mt-1 font-serif text-[11px] italic text-muted-foreground">
          {stretchNote}
        </p>
      </div>

      <div>
        <FieldLabel htmlFor="caddy-particulars">Particulars</FieldLabel>
        <div className="flex flex-wrap gap-1.5" id="caddy-particulars">
          {PARTICULARS.map((entry) => {
            const on = particulars.includes(entry.id);
            return (
              <Chip
                key={entry.id}
                active={on}
                onClick={() =>
                  setParticulars((current) =>
                    on
                      ? current.filter((id) => id !== entry.id)
                      : [...current, entry.id],
                  )
                }
              >
                {entry.label}
              </Chip>
            );
          })}
        </div>
      </div>

      <div>
        <FieldLabel htmlFor="caddy-note">
          Anything the caddy should know
        </FieldLabel>
        <Input
          id="caddy-note"
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, NOTE_MAX))}
          placeholder="Short walks — one of us is on crutches"
        />
      </div>

      {hasPass ? null : (
        <p className="text-[10px] text-muted-foreground">
          The caddy comes with the green fee — {GREEN_FEE_PRICE}, one round, the
          whole table. Everything else on this page is free, and stays free.
        </p>
      )}

      <Button onClick={plan} disabled={pending || !where.trim()}>
        <PendingLabel
          pending={pending}
          busy={busy}
          label="Plan the round"
          pendingLabel="Walking the patch"
        />
      </Button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="min-h-11 text-xs font-semibold text-muted-foreground hover:text-fairway"
      >
        Not this round
      </button>
    </div>
  );
}
