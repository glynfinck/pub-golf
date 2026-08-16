"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormRow, FormRows } from "@/components/ui/form-row";
import { Input } from "@/components/ui/input";
import { PickerRow } from "@/components/ui/picker-row";
import { Slider } from "@/components/ui/slider";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { PendingLabel } from "@/components/ui/pending-label";
import { TeeTimeNudger } from "@/components/ui/tee-time";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { BriefSection } from "@/components/course/brief-parts";
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
          className="font-serif text-base leading-snug text-balance"
          data-testid="brief-sentence"
        >
          {brief.sentence}
        </p>
        <p className="tabular mt-1 text-[11px] font-semibold text-muted-foreground">
          {teeLine(brief.teeOffMinutes, brief.teeDay, brief.today)}
        </p>
      </div>

      <BriefSection title="The patch">
        <FormRows>
          <FormRow
            label={MAPS_BROWSER_KEY ? "Or name a patch" : "Where"}
            stacked
          >
            <Input
              id="caddy-where"
              value={brief.where}
              onChange={(event) =>
                brief.setWhere(event.target.value.slice(0, WHERE_MAX))
              }
              placeholder="Shoreditch, London"
            />
            <p className="text-[10px] text-muted-foreground">
              {searchError ?? "A neighbourhood, a street, a town."}
            </p>
          </FormRow>
        </FormRows>

        {/* **The destination field is gone.**
            It asked the host to name where the night finishes — which the walk
            they drew has already said, twice over: `gatherPubs` takes the
            stroke's own ends as the corridor's, and `readBrief` measures its
            arc length for the reach. Asking again was asking for something
            already answered, and it brought a whole second pace control with
            it. A typed patch is one patch now, paced by the spacing dial; a
            drawn walk is paced by its own length. `whereTo` stays on the wire
            and in `readBrief` so sessions written before this still read. */}
      </BriefSection>

      {/*
       * **One row per field, and the row is the constant.**
       * This was six wrapping `role="radiogroup"` chip sets — seventeen pills
       * in the first three fields alone, every group a different width and
       * every field a different height depending on where its own options
       * happened to wrap. Nothing lined up, so there was no column to scan and
       * no way to read the brief back before spending on it.
       *
       * What sits in a row's value slot follows the field, which is the whole
       * design: a four-way pick stays one tap (`ToggleGroup`), an ordered
       * quantity stays a drag (`Slider`), and only the genuinely long lists pay
       * the extra tap of a sheet. Same rhythm, same baseline, same right edge,
       * whichever it is.
       */}
      <BriefSection title="The round">
        <FormRows>
          {/* The counter-offer rides on the row's own note line rather than a
              paragraph beneath a chip group: the count is the lean search's
              floor, so this warns and names the hole count that fits — it never
              gates. The server still decides. */}
          <FormRow
            label="Holes"
            note={
              reach?.preview
                ? (thinPatchNote(reach.preview.count, brief.holes) ?? undefined)
                : undefined
            }
          >
            <ToggleGroup
              type="single"
              value={String(brief.holes)}
              onValueChange={(next) => {
                if (next) brief.setHoles(Number(next));
              }}
              aria-label="Holes"
            >
              {HOLE_CHOICES.map((count) => (
                <ToggleGroupItem key={count} value={String(count)}>
                  {count}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </FormRow>

          <PickerRow
            label="Kind of round"
            note={meaning}
            options={VIBES}
            value={[brief.vibe]}
            onChange={(next) => {
              if (next[0]) brief.setVibe(next[0]);
            }}
            hint="How hard the caddy makes it."
          />

          {/* Hidden rather than disabled when a walk is drawn, and that is a
              fix rather than tidiness: `targetKmFor` takes the stroke's own arc
              length and never reads `brief.stretch` at all, so this dial was
              sitting there doing nothing while looking exactly like a control. */}
          {stroke ? (
            <FormRow
              label="How far apart"
              note={`The walk you drew sets the pace — ${strokeLengthKm(stroke).toFixed(1)} km over ${brief.holes} holes.`}
            />
          ) : (
            <FormRow label="How far apart" note={stretchNote} stacked>
              {/* Four presets were the whole of it, so a perfectly ordinary
                  "seven minutes" was unsayable — and four buttons in a row said
                  nothing about the fact that a stretch is *more* than a short
                  hop. A track says the ordering without a word. */}
              <Slider
                value={[brief.stretch]}
                onValueChange={([next]) => brief.setStretch(next)}
                min={STRETCH_MIN}
                max={STRETCH_MAX}
                step={1}
                aria-label="Minutes between pubs"
              />
            </FormRow>
          )}
        </FormRows>
      </BriefSection>

      <BriefSection title="The night">
        <FormRows>
          {/* The tee-off is not decoration: it is what decides which pubs are
              open enough to be on the card at all, so it gets a real control
              rather than four evening chips. Seven days is more than a row can
              hold, so the day is a sheet and the time is a nudger. */}
          <PickerRow
            label="Which day"
            options={brief.days.map((choice) => ({
              id: choice.day,
              label: choice.label,
            }))}
            value={brief.teeDay == null ? [] : [brief.teeDay]}
            onChange={(next) => {
              if (next[0] != null) brief.setDay(next[0]);
            }}
            empty="Any day"
          />

          <FormRow label="First tee" note={teeOffNote(brief.teeOffMinutes)}>
            <TeeTimeNudger
              value={brief.teeOffMinutes}
              onChange={brief.setTeeOffMinutes}
            />
          </FormRow>
        </FormRows>
      </BriefSection>

      <BriefSection title="The card">
        <FormRows>
          {/* The one part of a hole the host could not say a word about, on the
              app whose unit is the drink. Unlike a particular this is not a
              claim about a pub — it is what the caddy may write — so it is not
              bound by the dossier-signal rule. `drinks-pourable` still refuses
              a beer where Google says none is poured. */}
          <PickerRow
            label="Drinking"
            multi
            options={MEASURES}
            value={brief.measures}
            onChange={(next) => brief.setMeasures(() => next)}
            empty="Whatever suits"
            note={
              brief.measures.length
                ? `The caddy keeps to ${measuresMeaning(brief.measures)}.`
                : "Nothing ticked, so the caddy pours what suits each pub."
            }
          />

          <PickerRow
            label="Particulars"
            multi
            options={PARTICULARS}
            value={brief.particulars}
            onChange={(next) => brief.setParticulars(() => next)}
            empty="None"
            note="Only asked for where Google can actually answer it."
          />

          <FormRow label="Anything the caddy should know" stacked>
            <Input
              id="caddy-note"
              value={brief.note}
              onChange={(event) =>
                brief.setNote(event.target.value.slice(0, NOTE_MAX))
              }
              placeholder="Short walks — one of us is on crutches"
            />
          </FormRow>
        </FormRows>
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
