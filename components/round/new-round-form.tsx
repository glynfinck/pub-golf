"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarDays, Minus, Plus, X } from "lucide-react";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Chip } from "@/components/ui/chip";
import { FieldLabel, Input } from "@/components/ui/input";
import { PendingLabel } from "@/components/ui/pending-label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Masthead } from "@/components/shell/masthead";
import { MembersOptions } from "@/components/round/members-options";
import { HouseMark } from "@/components/ui/house-mark";
import { Stepper } from "@/components/ui/stepper";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { createRound } from "@/lib/actions/rounds";
import { templateForHoleCount } from "@/lib/course-templates";
import type { DayPass } from "@/lib/data/billing";
import type { MyCourse } from "@/lib/data/courses";
import {
  clearParkedDraft,
  parkDraft,
  type NewRoundDraft,
} from "@/lib/new-round-draft";
import {
  MULLIGAN_STROKES,
  MAX_MULLIGANS,
  PENALTY_PRESETS,
} from "@/lib/rules";
import { clockTime12, formatDuration, roundMinutes } from "@/lib/time";
import { cn } from "@/lib/utils";

const FORMATS = [
  { id: "stroke", label: "Stroke play" },
  { id: "stableford", label: "Stableford" },
  { id: "match", label: "Match" },
  { id: "scramble", label: "Scramble" },
] as const;

/** The tee-time grain. Nobody tees off at 7:23 — quarter hours are enough. */
const TEE_MINUTE_STEP = 15;
/** The last tee the picker can set: 11:45 PM. */
const LAST_TEE_MINUTES = 24 * 60 - TEE_MINUTE_STEP;

const teeNudgeDown =
  "flex h-9 min-w-9 shrink-0 items-center justify-center rounded-md px-1 font-mono text-[11px] font-bold text-muted-foreground hover:bg-secondary disabled:opacity-30";
const teeNudgeUp =
  "flex h-9 min-w-9 shrink-0 items-center justify-center rounded-md px-1 font-mono text-[11px] font-bold text-fairway hover:bg-secondary disabled:opacity-30";

/** The price ladder a tap walks a penalty through. */
const PRICE_LADDER = [1, 2, 3, 5, 10, 20];

interface PenaltyRow {
  strokes: number;
  reason: string;
  on: boolean;
  /** A house special the host wrote, editable and removable. */
  custom: boolean;
}

/** "Sat 15 Aug" — the printed-card date form. */
function shortDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function NewRoundForm({
  courses,
  pass,
  billingOn = false,
  draft = null,
}: {
  courses: MyCourse[];
  /** The host's live green fee, if one is running. */
  pass?: DayPass | null;
  /** No Stripe key, no surface — the maps-key pattern. */
  billingOn?: boolean;
  /** A table half set when the host stepped out to pay. */
  draft?: NewRoundDraft | null;
}) {
  const router = useRouter();
  const { run, pending, busy } = useAction();
  const [name, setName] = useState(draft?.name ?? "The Invitational XXX");
  const [holes, setHoles] = useState(draft?.holes ?? 9);
  const [courseId, setCourseId] = useState<string | null>(
    draft?.courseId ?? null,
  );
  const [reversed, setReversed] = useState(draft?.reversed ?? false);
  const [format, setFormat] = useState<(typeof FORMATS)[number]["id"]>(
    FORMATS.find((option) => option.id === draft?.format)?.id ?? "stroke",
  );
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    hazards: true,
    timer: true,
    softSub: true,
    // Off by default: most rounds are between people who'd rather not know.
    handicaps: false,
    ...draft?.toggles,
  });
  const [minutesPerPub, setMinutesPerPub] = useState(draft?.minutesPerPub ?? 20);
  /** null = unscheduled: the host tees off when the group is stood there. */
  const [teeDate, setTeeDate] = useState<Date | null>(
    draft?.teeDate ? new Date(draft.teeDate) : null,
  );
  const [teeMinutes, setTeeMinutes] = useState(draft?.teeMinutes ?? 19 * 60);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [mulligans, setMulligans] = useState(draft?.mulligans ?? 0);
  const [rules, setRules] = useState<PenaltyRow[]>(
    () =>
      draft?.rules ??
      PENALTY_PRESETS.map((preset) => ({ ...preset, on: true, custom: false })),
  );

  const selectedCourse = courses.find((course) => course.id === courseId);

  // The 19th-hole estimate: pubs at the planned pace plus the walks, which
  // the course already carries (Google-measured for built courses, the
  // printed card's legs for the template). Reversal moves the walks around
  // but never their sum, so the estimate is direction-blind.
  const template = selectedCourse ? null : templateForHoleCount(holes);
  const holeCount = selectedCourse ? selectedCourse.hole_count : holes;
  const par = selectedCourse
    ? selectedCourse.par
    : (template ?? []).reduce((sum, hole) => sum + hole.par, 0);
  const walkTotal = selectedCourse
    ? selectedCourse.walk_minutes
    : (template ?? []).reduce(
        (sum, hole) => sum + (hole.walk_minutes_to_next ?? 0),
        0,
      );
  const totalMinutes = roundMinutes(holeCount, minutesPerPub, walkTotal);
  const finishLabel = clockTime12(teeMinutes + totalMinutes);
  const rulesOn = rules.filter(
    (rule) => rule.on && rule.reason.trim() !== "",
  ).length;

  const courseName = selectedCourse
    ? selectedCourse.name
    : `The Invitational${reversed ? ", reversed" : ""}`;
  const courseSummary = `${courseName} · ${holeCount} holes · par ${par} · ${format}`;
  const clockSummary = teeDate
    ? `${shortDate(teeDate)} · ${clockTime12(teeMinutes)} · ${minutesPerPub} min/pub · ~${finishLabel}`
    : `unscheduled · ${minutesPerPub} min/pub · pace ${formatDuration(totalMinutes)}`;
  const rulesSummary = `${rulesOn} ${rulesOn === 1 ? "rule" : "rules"} in force · ${
    mulligans === 0
      ? "no mulligans"
      : `${mulligans} ${mulligans === 1 ? "mulligan" : "mulligans"}`
  } · ${toggles.handicaps ? "handicaps" : "no handicaps"}`;

  function cyclePrice(index: number) {
    setRules((current) =>
      current.map((rule, i) => {
        if (i !== index) return rule;
        const at = PRICE_LADDER.indexOf(rule.strokes);
        return {
          ...rule,
          strokes: PRICE_LADDER[(at + 1) % PRICE_LADDER.length],
        };
      }),
    );
  }

  function setToggle(key: string, checked: boolean) {
    setToggles((state) => ({ ...state, [key]: checked }));
  }

  function nudgeTee(delta: number) {
    setTeeMinutes((current) =>
      Math.min(LAST_TEE_MINUTES, Math.max(0, current + delta)),
    );
  }

  /** Park the table before the trip to Stripe's page, so the host comes back
   * to the round they were setting rather than to a blank form. */
  function park() {
    parkDraft({
      name,
      holes,
      courseId,
      reversed,
      format,
      toggles,
      minutesPerPub,
      teeDate: teeDate ? teeDate.toISOString() : null,
      teeMinutes,
      mulligans,
      rules,
    });
  }

  function submit() {
    // The table is set; nothing is left to come back to.
    clearParkedDraft();
    run(async () => {
      // The advertised first tee, assembled only at submit. Advisory: it is
      // printed on the lobby and the invite, and locks nothing.
      let scheduledTeeOff: string | null = null;
      if (teeDate) {
        const tee = new Date(teeDate);
        tee.setHours(Math.floor(teeMinutes / 60), teeMinutes % 60, 0, 0);
        scheduledTeeOff = tee.toISOString();
      }
      try {
        await createRound({
          name,
          holes: holeCount,
          courseId,
          reversed,
          format,
          hazards: toggles.hazards,
          timer: toggles.timer,
          softSub: toggles.softSub,
          handicaps: toggles.handicaps,
          minutesPerPub,
          scheduledTeeOff,
          mulligans,
          // A rule with no offence on it is a half-typed thought, not a rule.
          penalties: rules
            .filter((rule) => rule.on && rule.reason.trim() !== "")
            .map((rule) => ({
              strokes: rule.strokes,
              reason: rule.reason.trim(),
            })),
        });
      } catch (error) {
        // createRound redirects on success; only real failures land here.
        if (error instanceof Error && !error.message.includes("NEXT_REDIRECT"))
          return { error: error.message };
        throw error;
      }
    });
  }

  const summaryClass =
    "tabular truncate font-mono text-[11px] font-normal text-muted-foreground group-aria-expanded/accordion-trigger:hidden";
  // A settings row: label left, control right, with breathing room so a
  // 48px control never presses against the divider above it. Rows stack in
  // a `divide-y` column, which owns the lines — rows never draw their own.
  const settingRow =
    "flex min-h-14 w-full items-center justify-between gap-3 py-2";

  return (
    <Screen>
      <Masthead
        back={{ href: "/", label: "Clubhouse" }}
        center={<HouseMark className="mx-auto size-6" />}
        busy={busy}
      />
      <ScreenHeader eyebrow="New round" title="Set the table" />

      <div>
        <FieldLabel htmlFor="round-name">Round name</FieldLabel>
        <Input
          id="round-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <Accordion
        type="multiple"
        defaultValue={["course"]}
        className="flex flex-col gap-2.5"
      >
        {/* ---------------- Course & format ---------------- */}
        <AccordionItem
          value="course"
          className="rounded-xl border border-border bg-card px-4"
        >
          <AccordionTrigger className="min-h-12 items-center hover:no-underline">
            <span className="flex min-w-0 flex-col gap-0.5 pr-2">
              <span className="text-sm font-extrabold">
                Course &amp; format
              </span>
              <span className={summaryClass}>{courseSummary}</span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="flex flex-col gap-4 pb-4">
            <div>
              <FieldLabel>Course</FieldLabel>
              <div className="flex flex-wrap gap-2">
                <Chip
                  active={courseId === null && !reversed}
                  onClick={() => {
                    setCourseId(null);
                    setReversed(false);
                  }}
                >
                  The Invitational · template
                </Chip>
                <Chip
                  active={courseId === null && reversed}
                  onClick={() => {
                    setCourseId(null);
                    setReversed(true);
                  }}
                >
                  The Invitational · reversed
                </Chip>
                {courses.map((course) => (
                  <Chip
                    key={course.id}
                    active={courseId === course.id}
                    onClick={() => {
                      setCourseId(course.id);
                      setReversed(false);
                    }}
                  >
                    {course.name} · {course.hole_count} holes
                  </Chip>
                ))}
              </div>
            </div>

            {/* The first tee. An empty book is never a dead end — the
                Invitational above is a real card and always has been — but a
                host who wants their own local round has nothing here yet, and
                a blank scorecard is a better answer than silence. The table is
                parked on the way out, so they come back to the round they were
                setting rather than to a blank form. */}
            {courses.length === 0 ? (
              <div className="engraved flex flex-col gap-2 rounded-xl bg-card px-4 py-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="eyebrow text-fairway">Your own card</span>
                  <span className="rounded-md border border-border px-1.5 py-0.5 text-[9px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
                    Nothing in the book
                  </span>
                </div>
                <div aria-hidden className="flex flex-col">
                  {[1, 2, 3].map((number) => (
                    <div
                      key={number}
                      className="flex items-baseline gap-2 border-b border-dotted border-border py-1 last:border-b-0"
                    >
                      <span className="tabular font-mono text-[11px] text-marker opacity-60">
                        {number}
                      </span>
                      <span className="leader flex-1" />
                      <span className="font-mono text-[10px] text-muted-foreground opacity-60">
                        par —
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Play the Invitational above, or make a card on your own local
                  pubs — it keeps for next time.
                </p>
                <Button
                  variant="outline"
                  size="compact"
                  className="h-11 w-full"
                  onClick={() => {
                    park();
                    router.push("/courses/new");
                  }}
                >
                  Plot a course
                </Button>
                <p className="text-center text-[10px] text-muted-foreground">
                  We&apos;ll keep this round set up while you do.
                </p>
              </div>
            ) : null}

            {selectedCourse ? (
              <p className="text-xs text-muted-foreground">
                {selectedCourse.hole_count} holes · par {selectedCourse.par} —
                the round takes a snapshot; editing the course later never
                changes a played card.
              </p>
            ) : (
              <div className="flex items-end gap-3">
                <div className="w-36 shrink-0">
                  <FieldLabel>Holes</FieldLabel>
                  <div className="flex min-h-12 items-center justify-between rounded-lg border border-input bg-card px-2">
                    <button
                      type="button"
                      aria-label="Fewer holes"
                      onClick={() =>
                        setHoles((count) => Math.max(1, count - 1))
                      }
                      className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
                    >
                      <Minus size={16} />
                    </button>
                    <span className="tabular font-mono font-bold">{holes}</span>
                    <button
                      type="button"
                      aria-label="More holes"
                      onClick={() =>
                        setHoles((count) => Math.min(18, count + 1))
                      }
                      className="flex size-9 items-center justify-center rounded-md text-fairway hover:bg-secondary"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
                {reversed ? (
                  <p className="pb-1 text-[11px] text-muted-foreground">
                    Back down the card — hole 1 is the printed 9th, walks and
                    local rules intact.
                  </p>
                ) : null}
              </div>
            )}

            <div>
              <FieldLabel>Format</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {FORMATS.map((option) => (
                  <Chip
                    key={option.id}
                    active={format === option.id}
                    onClick={() => setFormat(option.id)}
                  >
                    {option.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="border-t border-border">
              <label className={settingRow}>
                <span className="text-sm font-semibold">Hazards on course</span>
                <Switch
                  checked={toggles.hazards}
                  onCheckedChange={(checked) => setToggle("hazards", checked)}
                />
              </label>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ---------------- Clock & schedule ---------------- */}
        <AccordionItem
          value="clock"
          className="rounded-xl border border-border bg-card px-4"
        >
          <AccordionTrigger className="min-h-12 items-center hover:no-underline">
            <span className="flex min-w-0 flex-col gap-0.5 pr-2">
              <span className="text-sm font-extrabold">
                Clock &amp; schedule
              </span>
              <span className={summaryClass}>{clockSummary}</span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="flex flex-col gap-4 pb-4">
            <div className="flex flex-col divide-y divide-border">
            <div className={settingRow}>
              <span className="text-sm font-semibold">
                First tee
                <span className="block text-[10px] font-normal text-muted-foreground">
                  Printed on the lobby and the invite · locks nothing
                </span>
              </span>
              <Popover open={scheduleOpen} onOpenChange={setScheduleOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="compact" className="gap-1.5">
                    <CalendarDays size={14} aria-hidden />
                    {teeDate
                      ? `${shortDate(teeDate)} · ${clockTime12(teeMinutes)}`
                      : "Unscheduled · tap to set"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-auto p-3">
                  <Calendar
                    mode="single"
                    selected={teeDate ?? undefined}
                    onSelect={(day) => setTeeDate(day ?? null)}
                  />
                  {/* One readout, four nudges: any time of day on the
                      quarter hour, hour jumps still two buttons away. */}
                  <div className="mt-2 flex min-h-12 items-center gap-0.5 rounded-lg border border-input bg-card px-1.5">
                    <button
                      type="button"
                      aria-label="Tee off an hour earlier"
                      disabled={teeMinutes === 0}
                      onClick={() => nudgeTee(-60)}
                      className={teeNudgeDown}
                    >
                      −1h
                    </button>
                    <button
                      type="button"
                      aria-label="Tee off a quarter hour earlier"
                      disabled={teeMinutes === 0}
                      onClick={() => nudgeTee(-TEE_MINUTE_STEP)}
                      className={teeNudgeDown}
                    >
                      −15
                    </button>
                    <span className="tabular min-w-0 flex-1 text-center font-mono text-sm font-bold">
                      {clockTime12(teeMinutes)}
                    </span>
                    <button
                      type="button"
                      aria-label="Tee off a quarter hour later"
                      disabled={teeMinutes === LAST_TEE_MINUTES}
                      onClick={() => nudgeTee(TEE_MINUTE_STEP)}
                      className={teeNudgeUp}
                    >
                      +15
                    </button>
                    <button
                      type="button"
                      aria-label="Tee off an hour later"
                      disabled={teeMinutes === LAST_TEE_MINUTES}
                      onClick={() => nudgeTee(60)}
                      className={teeNudgeUp}
                    >
                      +1h
                    </button>
                  </div>
                  <div className="mt-2 flex justify-between gap-2">
                    <Button
                      variant="ghost"
                      size="compact"
                      onClick={() => {
                        setTeeDate(null);
                        setScheduleOpen(false);
                      }}
                    >
                      Clear
                    </Button>
                    <Button
                      size="compact"
                      disabled={!teeDate}
                      onClick={() => setScheduleOpen(false)}
                    >
                      Done
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className={settingRow}>
              <span className="text-sm font-semibold">Time at each pub</span>
              <Stepper
                className="w-36 shrink-0"
                value={minutesPerPub}
                onChange={setMinutesPerPub}
                min={5}
                max={60}
                step={5}
                label="minutes at each pub"
                format={(value) => `${value} min`}
              />
            </div>

            <label className={settingRow}>
              <span className="text-sm font-semibold">
                Shot clock on the card
                <span className="block text-[10px] font-normal text-muted-foreground">
                  Counts down {minutesPerPub} minutes on every phone
                </span>
              </span>
              <Switch
                checked={toggles.timer}
                onCheckedChange={(checked) => setToggle("timer", checked)}
              />
            </label>
            </div>

            {/* The 19th hole, computed: pubs at pace plus Google's walks. */}
            <div className="engraved rounded-xl bg-card px-4 py-3">
              <div className="flex items-baseline gap-2">
                <span className="eyebrow">The 19th hole</span>
                <span aria-hidden className="leader flex-1" />
                <span className="tabular font-serif text-xl">
                  {teeDate
                    ? `~${finishLabel}`
                    : `~${formatDuration(totalMinutes)}`}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {holeCount} pubs × {minutesPerPub} min + {walkTotal} min
                walking
                {teeDate ? ` from a ${clockTime12(teeMinutes)} tee` : ""}
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ---------------- House rules ---------------- */}
        <AccordionItem
          value="rules"
          className="rounded-xl border border-border bg-card px-4"
        >
          <AccordionTrigger className="min-h-12 items-center hover:no-underline">
            <span className="flex min-w-0 flex-col gap-0.5 pr-2">
              <span className="text-sm font-extrabold">House rules</span>
              <span className={summaryClass}>{rulesSummary}</span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="flex flex-col gap-4 pb-4">
            <div>
              <FieldLabel>Penalties · the house menu</FieldLabel>
              <div className="flex flex-col">
                {rules.map((rule, index) => (
                  <div
                    key={rule.custom ? `custom-${index}` : rule.reason}
                    className={cn(
                      "flex min-h-13 items-center gap-3 py-1.5",
                      index > 0 && "border-t border-dotted border-border",
                    )}
                  >
                    <button
                      type="button"
                      aria-label={`Change the price — currently ${rule.strokes} strokes`}
                      onClick={() => cyclePrice(index)}
                      className="tabular min-h-9 w-11 shrink-0 rounded-full border-[1.5px] border-hazard/50 font-mono text-xs font-bold text-hazard"
                    >
                      +{rule.strokes}
                    </button>
                    {rule.custom ? (
                      <>
                        <Input
                          value={rule.reason}
                          aria-label={`House special ${index + 1}`}
                          placeholder="Your rule — phones face down, left hand only…"
                          className="min-h-10 flex-1 text-sm"
                          onChange={(event) =>
                            setRules((current) =>
                              current.map((r, i) =>
                                i === index
                                  ? { ...r, reason: event.target.value }
                                  : r,
                              ),
                            )
                          }
                        />
                        <button
                          type="button"
                          aria-label={`Remove house special ${index + 1}`}
                          onClick={() =>
                            setRules((current) =>
                              current.filter((_, i) => i !== index),
                            )
                          }
                          className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
                        >
                          <X size={15} aria-hidden />
                        </button>
                      </>
                    ) : (
                      <>
                        <span
                          className={cn(
                            "min-w-0 flex-1 text-sm font-semibold",
                            !rule.on &&
                              "text-muted-foreground line-through decoration-1 opacity-70",
                          )}
                        >
                          {rule.reason}
                        </span>
                        <Switch
                          checked={rule.on}
                          aria-label={`${rule.reason} — in force`}
                          onCheckedChange={(checked) =>
                            setRules((current) =>
                              current.map((r, i) =>
                                i === index ? { ...r, on: checked } : r,
                              ),
                            )
                          }
                        />
                      </>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  setRules((current) => [
                    ...current,
                    { strokes: 2, reason: "", on: true, custom: true },
                  ])
                }
                className="mt-1 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-border text-xs font-bold text-fairway hover:bg-secondary/50"
              >
                <Plus size={14} aria-hidden /> Write a house special
              </button>
            </div>

            <div className="flex flex-col divide-y divide-border border-t border-border">
              <div className={settingRow}>
                <span className="text-sm font-semibold">
                  Mulligans each
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    {mulligans === 0
                      ? "No bail-outs — every drink gets finished."
                      : `A half pint wipes the hole, for +${MULLIGAN_STROKES} on the card.`}
                  </span>
                </span>
                <Stepper
                  className="w-32 shrink-0"
                  value={mulligans}
                  onChange={setMulligans}
                  max={MAX_MULLIGANS}
                  label="mulligans"
                  format={(value) => (value === 0 ? "off" : String(value))}
                />
              </div>

              <label className={settingRow}>
                <span className="text-sm font-semibold">
                  Soft substitute scores par
                </span>
                <Switch
                  checked={toggles.softSub}
                  onCheckedChange={(checked) => setToggle("softSub", checked)}
                />
              </label>
              <label className={settingRow}>
                <span className="text-sm font-semibold">Player handicaps</span>
                <Switch
                  checked={toggles.handicaps}
                  onCheckedChange={(checked) => setToggle("handicaps", checked)}
                />
              </label>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* The covenant's first of two moments money may speak. Below the
          round's own options, above the one primary action, and gone
          entirely when the till isn't plugged in. */}
      {billingOn || pass ? (
        <MembersOptions pass={pass ?? null} onLeave={park} />
      ) : null}

      <Button
        onClick={submit}
        disabled={pending || !name.trim()}
        className="mt-auto"
      >
        <PendingLabel
          pending={pending}
          busy={busy}
          label={
            teeDate
              ? `Create round · tees off ${shortDate(teeDate)} ${clockTime12(teeMinutes)}`
              : `Create round · ${holeCount} holes on ${courseName}`
          }
          pendingLabel="Setting up the course"
        />
      </Button>
    </Screen>
  );
}
