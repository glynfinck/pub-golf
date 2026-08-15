"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { FieldLabel, Input } from "@/components/ui/input";
import { PendingLabel } from "@/components/ui/pending-label";
import { Stepper } from "@/components/ui/stepper";
import { TeeTimeNudger } from "@/components/ui/tee-time";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Ask, BriefSection } from "@/components/course/brief-parts";
import {
  CaddyRefusalSheets,
  CoveredBadge,
} from "@/components/course/caddy-fee-panels";
import { CaddyUsage } from "@/components/course/caddy-usage";
import { useBrief } from "@/hooks/use-brief";
import { useReach } from "@/hooks/use-reach";
import { useCountdown } from "@/hooks/use-countdown";
import type { CaddyJobHandle } from "@/hooks/use-caddy-job";
import {
  HOLE_CHOICES,
  MEASURES,
  measuresMeaning,
  NOTE_MAX,
  PARTICULARS,
  STRETCH_MAX,
  STRETCH_MIN,
  stretchMeaning,
  VIBES,
  WHERE_MAX,
} from "@/lib/caddy/brief";
import { freshCourseNotice } from "@/lib/caddy/credits";
import { thinPatchNote } from "@/lib/caddy/preflight";
import { teeLine, teeOffNote } from "@/lib/caddy/tee-off";
import { strokeLengthKm, type StrokePoint } from "@/lib/caddy/stroke";
import type { Reach } from "@/lib/caddy/reach";
import { MAPS_BROWSER_KEY } from "@/lib/maps";
import { formatTimeLeft } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * The brief: what the host asks the caddy for, and the button that asks it.
 *
 * **The room's face, and only the room's.** This used to be one branch of a
 * five-branch component shared with the drafting table, chosen by a `room`
 * boolean that four of the five branches ignored — so a resumed host opening
 * the Course Room was shown the *table's* ask box instead of this, over an
 * empty map, with no brief, no Plan button and no card. `/plan` could not
 * plan. Splitting the faces is what fixes that: each room composes the one it
 * wants, and there is no branch left to fall through.
 *
 * It renders no chrome of its own. The room's `RetractingPanel` is the
 * furniture, which is what stops the card-inside-a-card the shared component
 * produced whenever it kept the table's `engraved` ring inside the panel.
 */
export function BriefForm({
  job,
  hasPass,
  allowance,
  passExpiresAt = null,
  filed = false,
  stroke = null,
  onReach,
  className,
}: {
  job: CaddyJobHandle;
  hasPass: boolean;
  allowance?: { canPlan: boolean; left: number; courseId: string | null };
  passExpiresAt?: string | null;
  filed?: boolean;
  /** The walk drawn on the room's own map. */
  stroke?: StrokePoint[] | null;
  /** The patch, as the room learned it — so the map's ring and this form's
   * counter-offer are read from one value. */
  onReach?: (reach: Reach | null) => void;
  className?: string;
}) {
  const brief = useBrief({ stroke });
  // The room frames its map on the same reach this form counts pubs from.
  const { reach, searchError } = useReach(brief.where, brief.holes, onReach);
  const [confirming, setConfirming] = useState(false);
  const passLeftMs = useCountdown(
    passExpiresAt ? Date.parse(passExpiresAt) : null,
  );

  const meaning = VIBES.find((entry) => entry.id === brief.vibe)?.meaning ?? "";
  const stretchNote = stretchMeaning(brief.stretch);

  /** Ask for a patch. The job owns everything that happens next. */
  function plan() {
    if (!MAPS_BROWSER_KEY) {
      toast.error("No map on this deploy — the caddy needs one to look.");
      return;
    }
    void job.openPlan(brief.briefBody());
  }

  /**
   * Before a fresh card: what it replaces, and how long the fee has to run.
   *
   * A sheet rather than a `confirm()` because there are two facts to carry and
   * a browser dialog can carry neither well. It is the only thing standing
   * between a host and writing over an evening's work — a fee files one
   * course, so planning again replaces the one in the book.
   */
  const freshSheet = (
    <Sheet
      open={confirming}
      onOpenChange={(open) => !open && setConfirming(false)}
    >
      <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-2xl">
        <SheetHeader className="pb-0 text-center">
          <SheetTitle className="eyebrow text-center text-fairway">
            The caddy
          </SheetTitle>
          <SheetDescription className="font-serif text-xl text-foreground not-italic">
            {filed ? "Plan a different course?" : "Ready when you are"}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4 pb-6">
          {freshCourseNotice({
            dormant: passExpiresAt === null,
            timeLeft: formatTimeLeft(passLeftMs),
            replacing: filed,
            cardsLeftAfter: Math.max(0, (allowance?.left ?? 1) - 1),
          }).map((line) => (
            <p key={line} className="text-center text-xs text-muted-foreground">
              {line}
            </p>
          ))}
          <Button
            className="mt-1 w-full"
            onClick={() => {
              setConfirming(false);
              plan();
            }}
            data-testid="confirm-fresh-course"
          >
            {filed ? "Plan it anyway" : "Plan the round"}
          </Button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="min-h-11 text-xs font-semibold text-muted-foreground hover:text-fairway"
          >
            Not yet
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );

  return (
    <div className={cn("flex flex-col gap-3", "px-4 pt-2 pb-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow text-fairway">The brief</span>
        {/* "Covered" was the whole of what a host could see, and it went on
            saying Covered after the last course had been planned. A pass has
            two dimensions and this badge only ever showed one — so once there
            is a fee, what it says is what is left on it. With no fee it says
            nothing at all: the price belongs to the refusal, not to the form. */}
        {hasPass ? (
          allowance ? (
            <CaddyUsage left={allowance.left} />
          ) : (
            <CoveredBadge />
          )
        ) : null}
      </div>
      {/* The brief, read back as a sentence.
          A form is a list of settings; a brief is a commission, and the
          difference on screen is whether anything says the whole of it back.
          Every tap rewrites this, so the host reads what they have asked for
          rather than reassembling it from eight groups of chips. */}
      <div className="rounded-xl border border-border bg-secondary/40 px-3.5 py-3">
        <p
          className="font-serif text-[15px] leading-snug text-balance"
          data-testid="brief-sentence"
        >
          {brief.sentence}
        </p>
        <p className="tabular mt-1 text-[11px] font-semibold text-muted-foreground">
          {teeLine(brief.teeOffMinutes, brief.teeDay, brief.today)}
        </p>
      </div>

      <BriefSection title="The patch">
        <div>
          <FieldLabel htmlFor="caddy-where">
            {MAPS_BROWSER_KEY ? "Or name a patch" : "Where"}
          </FieldLabel>
          <Input
            id="caddy-where"
            value={brief.where}
            onChange={(event) =>
              brief.setWhere(event.target.value.slice(0, WHERE_MAX))
            }
            placeholder="Shoreditch, London"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            {searchError ?? "A neighbourhood, a street, a town."}
          </p>
        </div>

        {/* **The destination field is gone.**
            It asked the host to name brief.where the night finishes — which the walk
            they drew has already said, twice over: `gatherPubs` takes the
            stroke's own ends as the corridor's, and `readBrief` brief.measures its
            arc length for the reach. Asking again was asking for something
            already answered, and it brought a whole second pace control with
            it. A typed patch is one patch now, paced by the spacing dial; a
            drawn walk is paced by its own length. `whereTo` stays on the wire
            and in `readBrief` so sessions written before this still read. */}
      </BriefSection>

      <BriefSection title="The round">
        <Ask id="caddy-holes" label="Holes">
          <div
            className="flex flex-wrap gap-1.5"
            role="radiogroup"
            aria-labelledby="caddy-holes"
          >
            {HOLE_CHOICES.map((count) => (
              <Chip
                key={count}
                role="radio"
                aria-checked={brief.holes === count}
                active={brief.holes === count}
                onClick={() => brief.setHoles(count)}
              >
                {count}
              </Chip>
            ))}
          </div>
          {/* The counter-offer, before the button rather than after the fee:
              the count is the lean search's floor, so this warns and names the
              hole count that fits — it never gates. The server still decides. */}
          {reach?.preview
            ? (() => {
                const thin = thinPatchNote(reach.preview.count, brief.holes);
                return thin ? (
                  <p className="mt-1 text-[10px] text-hazard">{thin}</p>
                ) : null;
              })()
            : null}
        </Ask>

        <Ask id="caddy-vibe" label="What kind of round" note={meaning}>
          <div
            className="flex flex-wrap gap-1.5"
            role="radiogroup"
            aria-labelledby="caddy-vibe"
          >
            {VIBES.map((entry) => (
              <Chip
                key={entry.id}
                role="radio"
                aria-checked={brief.vibe === entry.id}
                active={brief.vibe === entry.id}
                onClick={() => brief.setVibe(entry.id)}
              >
                {entry.label}
              </Chip>
            ))}
          </div>
        </Ask>

        {/* Hidden rather than disabled when a walk is drawn, and that is a fix
            rather than tidiness: `targetKmFor` takes the stroke's own arc
            length and never reads `brief.stretch` at all, so this dial was sitting
            there doing nothing while looking exactly like a control. */}
        {stroke ? (
          <p className="font-serif text-[11px] italic text-muted-foreground">
            The walk you drew sets the pace —{" "}
            {strokeLengthKm(stroke).toFixed(1)} km over {brief.holes}{" "}
            brief.holes.
          </p>
        ) : (
          <Ask
            id="caddy-stretch"
            label="How far apart"
            note={stretchNote}
            className="items-start"
          >
            {/* Four presets were the whole of it, so a perfectly ordinary
                "seven minutes" was unsayable. The dial is the host's now. */}
            <Stepper
              className="w-40"
              value={brief.stretch}
              onChange={brief.setStretch}
              min={STRETCH_MIN}
              max={STRETCH_MAX}
              label="minutes between pubs"
              decrementLabel="Less walking between pubs"
              incrementLabel="More walking between pubs"
              format={(value) => (value === 0 ? "any" : `${value} min`)}
            />
          </Ask>
        )}
      </BriefSection>

      <BriefSection title="The night">
        {/* The tee-off is not decoration: it is what decides which pubs are
            open enough to be on the card at all, so it gets a real control
            rather than four evening chips. */}
        <Ask id="caddy-day" label="Which day">
          <div
            className="flex flex-wrap gap-1.5"
            role="radiogroup"
            aria-labelledby="caddy-day"
          >
            {brief.days.map((choice) => (
              <Chip
                key={choice.day}
                role="radio"
                aria-checked={brief.teeDay === choice.day}
                active={brief.teeDay === choice.day}
                onClick={() => brief.setDay(choice.day)}
              >
                {choice.label}
              </Chip>
            ))}
          </div>
        </Ask>

        <Ask
          id="caddy-tee"
          label="First tee"
          note={teeOffNote(brief.teeOffMinutes)}
          className="items-start"
        >
          <TeeTimeNudger
            value={brief.teeOffMinutes}
            onChange={brief.setTeeOffMinutes}
          />
        </Ask>
      </BriefSection>

      <BriefSection title="The card">
        {/* The one part of a hole the host could not say a word about, on the
            app whose unit is the drink. Unlike a particular this is not a
            claim about a pub — it is what the caddy may write — so it is not
            bound by the dossier-signal rule. `drinks-pourable` still refuses a
            beer brief.where Google says none is poured. */}
        <Ask
          id="caddy-measures"
          label="What you are drinking"
          note={
            brief.measures.length
              ? `The caddy keeps to ${measuresMeaning(brief.measures)}.`
              : "Nothing ticked, so the caddy pours what suits each pub."
          }
        >
          <div
            className="flex flex-wrap gap-1.5"
            aria-labelledby="caddy-measures"
          >
            {MEASURES.map((entry) => {
              const on = brief.measures.includes(entry.id);
              return (
                <Chip
                  key={entry.id}
                  active={on}
                  aria-pressed={on}
                  onClick={() =>
                    brief.setMeasures((current) =>
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
        </Ask>

        <Ask
          id="caddy-particulars"
          label="Particulars"
          note="Only asked for where Google can actually answer it."
        >
          <div
            className="flex flex-wrap gap-1.5"
            aria-labelledby="caddy-particulars"
          >
            {PARTICULARS.map((entry) => {
              const on = brief.particulars.includes(entry.id);
              return (
                <Chip
                  key={entry.id}
                  active={on}
                  aria-pressed={on}
                  onClick={() =>
                    brief.setParticulars((current) =>
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
        </Ask>

        <div>
          <FieldLabel htmlFor="caddy-note">
            Anything the caddy should know
          </FieldLabel>
          <Input
            id="caddy-note"
            value={brief.note}
            onChange={(event) =>
              brief.setNote(event.target.value.slice(0, NOTE_MAX))
            }
            placeholder="Short walks — one of us is on crutches"
          />
        </div>
      </BriefSection>

      {/* This line quoted the price. It has been kept, without it: what a host
          needs before they press the button is that the caddy is the members'
          part and the rest of the page is not — the number is the refusal's
          business, one tap away, on a sheet with a door in it. */}
      {hasPass ? null : (
        <p className="text-[10px] text-muted-foreground">
          The caddy is the members&apos; part — one round, the whole table.
          Everything else on this page is free, and stays free.
        </p>
      )}

      {freshSheet}
      <CaddyRefusalSheets job={job} courseId={allowance?.courseId} />
      {/* The confirmation is entirely about a fee: what a fresh card writes
          over, how long the day has to run, how many goes are left after
          this one. A host without one was being shown all three — "your
          fee's day begins when you tee off" over a fee they had never
          bought, and "this is the last whole card on it" counted off an
          allowance of nothing. Same conflation as the spent panel, one
          screen earlier and without the shelf.

          So with no fee there is nothing to confirm: the ask goes straight
          to the server, which answers it with the green fee. The price
          still arrives with the job.refusal, which is the covenant's own
          order. (The ask now goes via the open step — same gate, same
          job.refusal, same sheet.) */}
      {/* Keyed on the job, not on `pending`. `pending` belongs to the ask
          box's own transition; while a plan runs it is false, and while an ask
          runs the plan button has no business being disabled by it. */}
      <Button
        onClick={() => (hasPass ? setConfirming(true) : plan())}
        disabled={job.working || !(brief.where.trim() || stroke)}
      >
        <PendingLabel
          pending={job.working}
          busy={job.working}
          label="Plan the round"
          pendingLabel="Walking the patch"
        />
      </Button>
    </div>
  );
}

/**
 * A paid-up host's badge — the one state of the old fee badge that survives.
 *
 * The other state quoted a price, and that is the whole of what this
 * extraction is for: `Covered` is a fact about the host, which the group may
 * say whenever it likes. A price is an offer, which it may make only in
 * answer to a refusal. Two things wearing one badge is how they came to be
 * confused, so now only one of them has a badge.
 */
