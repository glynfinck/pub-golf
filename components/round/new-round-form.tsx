"use client";

import { useState, useTransition } from "react";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { FieldLabel, Input } from "@/components/ui/input";
import { RuleDouble } from "@/components/ui/rule";
import { Stepper } from "@/components/ui/stepper";
import { Switch } from "@/components/ui/switch";
import { createRound } from "@/lib/actions/rounds";
import type { MyCourse } from "@/lib/data/courses";
import {
  BREAKFAST_BALL_STROKES,
  MAX_BREAKFAST_BALLS,
  PENALTY_PRESETS,
} from "@/lib/rules";
import { cn } from "@/lib/utils";

const FORMATS = [
  { id: "stroke", label: "Stroke play" },
  { id: "stableford", label: "Stableford" },
  { id: "match", label: "Match" },
  { id: "scramble", label: "Scramble" },
] as const;

const TOGGLES = [
  { key: "hazards", label: "Hazards on course" },
  { key: "timer", label: "20-min hole timer" },
  { key: "softSub", label: "Soft substitute scores par" },
  { key: "handicaps", label: "Player handicaps" },
] as const;

export function NewRoundForm({ courses }: { courses: MyCourse[] }) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("The Glyn Invitational XXX");
  const [holes, setHoles] = useState(9);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [format, setFormat] =
    useState<(typeof FORMATS)[number]["id"]>("stroke");
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    hazards: true,
    timer: true,
    softSub: true,
    // Off by default: most rounds are between people who'd rather not know.
    handicaps: false,
  });
  const [breakfastBalls, setBreakfastBalls] = useState(0);
  const [penalties, setPenalties] = useState<Set<number>>(
    new Set(PENALTY_PRESETS.map((_, index) => index)),
  );

  const selectedCourse = courses.find((course) => course.id === courseId);

  function submit() {
    startTransition(async () => {
      try {
        await createRound({
          name,
          holes: selectedCourse ? selectedCourse.hole_count : holes,
          courseId,
          format,
          hazards: toggles.hazards,
          timer: toggles.timer,
          softSub: toggles.softSub,
          handicaps: toggles.handicaps,
          breakfastBalls,
          penalties: PENALTY_PRESETS.filter((_, index) =>
            penalties.has(index),
          ),
        });
      } catch (error) {
        // createRound redirects on success; only real failures land here.
        if (error instanceof Error && !error.message.includes("NEXT_REDIRECT"))
          toast.error(error.message);
        else throw error;
      }
    });
  }

  return (
    <Screen>
      <RuleDouble />
      <ScreenHeader eyebrow="New round" title="Set the table" />

      <div>
        <FieldLabel htmlFor="round-name">Round name</FieldLabel>
        <Input
          id="round-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div>
        <FieldLabel>Course</FieldLabel>
        <div className="flex flex-wrap gap-2">
          <Chip active={courseId === null} onClick={() => setCourseId(null)}>
            The Invitational · template
          </Chip>
          {courses.map((course) => (
            <Chip
              key={course.id}
              active={courseId === course.id}
              onClick={() => setCourseId(course.id)}
            >
              {course.name} · {course.hole_count} holes
            </Chip>
          ))}
        </div>
      </div>

      {selectedCourse ? (
        <p className="text-xs text-muted-foreground">
          {selectedCourse.hole_count} holes · par {selectedCourse.par} — the
          round takes a snapshot; editing the course later never changes a
          played card.
        </p>
      ) : (
        <div className="w-36">
          <FieldLabel>Holes</FieldLabel>
          <div className="flex min-h-12 items-center justify-between rounded-lg border border-input bg-card px-2">
            <button
              type="button"
              aria-label="Fewer holes"
              onClick={() => setHoles((count) => Math.max(1, count - 1))}
              className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
            >
              <Minus size={16} />
            </button>
            <span className="tabular font-mono font-bold">{holes}</span>
            <button
              type="button"
              aria-label="More holes"
              onClick={() => setHoles((count) => Math.min(18, count + 1))}
              className="flex size-9 items-center justify-center rounded-md text-fairway hover:bg-secondary"
            >
              <Plus size={16} />
            </button>
          </div>
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

      <Card className="gap-0 px-4 py-1">
        {TOGGLES.map(({ key, label }, index) => (
          <label
            key={key}
            className={cn(
              "flex min-h-12 w-full items-center justify-between",
              index > 0 && "border-t border-border",
            )}
          >
            <span className="text-sm font-semibold">{label}</span>
            <Switch
              checked={toggles[key]}
              onCheckedChange={(checked) =>
                setToggles((state) => ({ ...state, [key]: checked }))
              }
            />
          </label>
        ))}
      </Card>

      <div>
        <FieldLabel htmlFor="breakfast-balls">Breakfast balls each</FieldLabel>
        <div className="flex items-center gap-3">
          <Stepper
            className="w-36 shrink-0"
            value={breakfastBalls}
            onChange={setBreakfastBalls}
            max={MAX_BREAKFAST_BALLS}
            label="breakfast balls"
            format={(value) => (value === 0 ? "off" : String(value))}
          />
          <p className="text-[11px] text-muted-foreground">
            {breakfastBalls === 0
              ? "No bail-outs — every drink gets finished."
              : `A half pint wipes the hole and starts it again, for +${BREAKFAST_BALL_STROKES} on the card.`}
          </p>
        </div>
      </div>

      <div>
        <FieldLabel>House penalties · tap to include</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {PENALTY_PRESETS.map((penalty, index) => (
            <Chip
              key={penalty.reason}
              active={penalties.has(index)}
              onClick={() =>
                setPenalties((selected) => {
                  const next = new Set(selected);
                  if (next.has(index)) next.delete(index);
                  else next.add(index);
                  return next;
                })
              }
            >
              +{penalty.strokes} {penalty.reason.split(" — ")[0].toLowerCase()}
            </Chip>
          ))}
        </div>
      </div>

      <Button onClick={submit} disabled={pending || !name.trim()}>
        {pending
          ? "Setting up the course…"
          : `Create round · ${
              selectedCourse
                ? `${selectedCourse.hole_count} holes on ${selectedCourse.name}`
                : `${holes} holes on the Invitational course`
            }`}
      </Button>
    </Screen>
  );
}
