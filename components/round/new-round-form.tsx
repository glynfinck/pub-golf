"use client";

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
import { RuleDouble } from "@/components/ui/rule";
import { Stepper } from "@/components/ui/stepper";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { createRound } from "@/lib/actions/rounds";
import { templateForHoleCount } from "@/lib/course-templates";
import type { MyCourse } from "@/lib/data/courses";
import {
  BREAKFAST_BALL_STROKES,
  MAX_BREAKFAST_BALLS,
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

/** First-tee choices. Nobody tees off at 7:23 — chips beat a wheel. */
const TEE_TIMES = [
  { label: "6pm", minutes: 18 * 60 },
  { label: "6:30", minutes: 18 * 60 + 30 },
  { label: "7pm", minutes: 19 * 60 },
  { label: "7:30", minutes: 19 * 60 + 30 },
  { label: "8pm", minutes: 20 * 60 },
];

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

export function NewRoundForm({ courses }: { courses: MyCourse[] }) {
  const { run, pending, busy } = useAction();
  const [name, setName] = useState("The Glyn Invitational XXX");
  const [holes, setHoles] = useState(9);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [reversed, setReversed] = useState(false);
  const [format, setFormat] =
    useState<(typeof FORMATS)[number]["id"]>("stroke");
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    hazards: true,
    timer: true,
    softSub: true,
    // Off by default: most rounds are between people who'd rather not know.
    handicaps: false,
  });
  const [minutesPerPub, setMinutesPerPub] = useState(20);
  /** null = unscheduled: the host tees off when the group is stood there. */
  const [teeDate, setTeeDate] = useState<Date | null>(null);
  const [teeMinutes, setTeeMinutes] = useState(19 * 60);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [breakfastBalls, setBreakfastBalls] = useState(0);
  const [rules, setRules] = useState<PenaltyRow[]>(() =>
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
    breakfastBalls === 0
      ? "no breakfast balls"
      : `${breakfastBalls} breakfast ${breakfastBalls === 1 ? "ball" : "balls"}`
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

  function submit() {
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
          breakfastBalls,
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
  const toggleRow =
    "flex min-h-12 w-full items-center justify-between gap-3 border-t border-border";

  return (
    <Screen>
      <RuleDouble busy={busy} />
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
          <AccordionContent className="flex flex-col gap-4">
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

            <label className={cn(toggleRow, "border-t-0")}>
              <span className="text-sm font-semibold">Hazards on course</span>
              <Switch
                checked={toggles.hazards}
                onCheckedChange={(checked) => setToggle("hazards", checked)}
              />
            </label>
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
          <AccordionContent className="flex flex-col gap-4">
            <div className="flex min-h-12 items-center justify-between gap-3">
              <span className="text-sm font-semibold">First tee</span>
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
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {TEE_TIMES.map((time) => (
                      <Chip
                        key={time.label}
                        className="min-h-9 px-3"
                        active={teeMinutes === time.minutes}
                        onClick={() => setTeeMinutes(time.minutes)}
                      >
                        {time.label}
                      </Chip>
                    ))}
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
            <p className="-mt-3 text-[11px] text-muted-foreground">
              Printed on the lobby and the invite. Nothing locks — you still
              tee off when the group is stood there.
            </p>

            <div className="flex min-h-12 items-center justify-between gap-3">
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

            <label className={toggleRow}>
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
          <AccordionContent className="flex flex-col gap-4">
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

            <div className="flex min-h-12 items-center justify-between gap-3 border-t border-border">
              <span className="text-sm font-semibold">
                Breakfast balls each
                <span className="block text-[10px] font-normal text-muted-foreground">
                  {breakfastBalls === 0
                    ? "No bail-outs — every drink gets finished."
                    : `A half pint wipes the hole, for +${BREAKFAST_BALL_STROKES} on the card.`}
                </span>
              </span>
              <Stepper
                className="w-32 shrink-0"
                value={breakfastBalls}
                onChange={setBreakfastBalls}
                max={MAX_BREAKFAST_BALLS}
                label="breakfast balls"
                format={(value) => (value === 0 ? "off" : String(value))}
              />
            </div>

            <label className={toggleRow}>
              <span className="text-sm font-semibold">
                Soft substitute scores par
              </span>
              <Switch
                checked={toggles.softSub}
                onCheckedChange={(checked) => setToggle("softSub", checked)}
              />
            </label>
            <label className={cn(toggleRow, "-mt-2")}>
              <span className="text-sm font-semibold">Player handicaps</span>
              <Switch
                checked={toggles.handicaps}
                onCheckedChange={(checked) => setToggle("handicaps", checked)}
              />
            </label>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

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
