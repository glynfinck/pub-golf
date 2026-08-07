"use client";

import { Minus, Plus, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { FieldLabel, Input } from "@/components/ui/input";
import { MAX_LOCAL_RULES } from "@/lib/rules";
import type { RulesetPenalty } from "@/lib/ruleset";

export interface DraftHole {
  venue_id: string | null;
  venue_name: string;
  address: string | null;
  rating: number | null;
  lat: number | null;
  lng: number | null;
  drink: string;
  par: number;
  hazard: "water" | "bunker" | "dogleg" | null;
  hazard_note: string | null;
  /** Local rules: offered on this hole's penalty sheet and nowhere else. */
  penalties: RulesetPenalty[];
}

const HAZARDS = [
  { id: null, label: "No hazard" },
  { id: "water", label: "Water" },
  { id: "bunker", label: "Bunker" },
  { id: "dogleg", label: "Dogleg" },
] as const;

/** One hole on the drafting table: par, drink, hazard. */
export function HoleEditor({
  hole,
  number,
  onChange,
  onRemove,
}: {
  hole: DraftHole;
  number: number;
  onChange: (patch: Partial<DraftHole>) => void;
  onRemove: () => void;
}) {
  return (
    <Card className="gap-2.5 px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        <span className="tabular flex size-8 shrink-0 items-center justify-center rounded-full border-[1.5px] border-marker font-serif text-marker">
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-serif text-base italic">
            {hole.venue_name}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {hole.address ?? "Added by hand"}
            {hole.rating ? ` · ★ ${hole.rating}` : ""}
          </div>
        </div>
        <button
          type="button"
          aria-label={`Remove ${hole.venue_name}`}
          onClick={onRemove}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <FieldLabel htmlFor={`drink-${number}`}>The drink</FieldLabel>
          <Input
            id={`drink-${number}`}
            value={hole.drink}
            onChange={(event) => onChange({ drink: event.target.value })}
          />
        </div>
        <div className="shrink-0">
          <FieldLabel>Par</FieldLabel>
          <div className="flex min-h-12 items-center gap-1 rounded-lg border border-input bg-card px-1.5">
            <button
              type="button"
              aria-label={`Lower par on hole ${number}`}
              onClick={() => onChange({ par: Math.max(1, hole.par - 1) })}
              className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
            >
              <Minus size={15} aria-hidden />
            </button>
            <span className="tabular min-w-5 text-center font-mono font-bold">
              {hole.par}
            </span>
            <button
              type="button"
              aria-label={`Raise par on hole ${number}`}
              onClick={() => onChange({ par: Math.min(20, hole.par + 1) })}
              className="flex size-9 items-center justify-center rounded-md text-fairway hover:bg-secondary"
            >
              <Plus size={15} aria-hidden />
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {HAZARDS.map((option) => (
          <Chip
            key={option.label}
            active={hole.hazard === option.id}
            onClick={() =>
              onChange({
                hazard: option.id,
                hazard_note: option.id ? hole.hazard_note : null,
              })
            }
            className="min-h-9 px-3 text-[11px]"
          >
            {option.label}
          </Chip>
        ))}
      </div>
      {hole.hazard ? (
        <Input
          aria-label={`Hazard note for hole ${number}`}
          placeholder="The house rule — e.g. no toilet for the whole hole"
          value={hole.hazard_note ?? ""}
          onChange={(event) => onChange({ hazard_note: event.target.value })}
        />
      ) : null}

      <LocalRules
        number={number}
        penalties={hole.penalties}
        onChange={(penalties) => onChange({ penalties })}
      />
    </Card>
  );
}

/**
 * Local rules: the offences this pub adds to the penalty sheet. A hazard note
 * says what the rule is; this says what it costs, which is the part the card
 * can actually score.
 */
function LocalRules({
  number,
  penalties,
  onChange,
}: {
  number: number;
  penalties: RulesetPenalty[];
  onChange: (penalties: RulesetPenalty[]) => void;
}) {
  function patch(index: number, next: Partial<RulesetPenalty>) {
    onChange(
      penalties.map((rule, i) => (i === index ? { ...rule, ...next } : rule)),
    );
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-dotted border-border pt-2.5">
      <FieldLabel>Local rules · this hole only</FieldLabel>

      {penalties.map((rule, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input
            aria-label={`Local rule ${index + 1} on hole ${number}`}
            placeholder="The offence — e.g. drinking with your right hand"
            value={rule.reason}
            onChange={(event) => patch(index, { reason: event.target.value })}
            className="min-h-11 min-w-0 flex-1 text-sm"
          />
          <div className="flex min-h-11 shrink-0 items-center gap-0.5 rounded-lg border border-input bg-card px-1">
            <button
              type="button"
              aria-label={`Lower the strokes on local rule ${index + 1} of hole ${number}`}
              onClick={() =>
                patch(index, { strokes: Math.max(1, rule.strokes - 1) })
              }
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
            >
              <Minus size={14} aria-hidden />
            </button>
            <span className="tabular min-w-6 text-center font-mono text-xs font-bold text-hazard">
              +{rule.strokes}
            </span>
            <button
              type="button"
              aria-label={`Raise the strokes on local rule ${index + 1} of hole ${number}`}
              onClick={() =>
                patch(index, { strokes: Math.min(20, rule.strokes + 1) })
              }
              className="flex size-8 items-center justify-center rounded-md text-hazard hover:bg-secondary"
            >
              <Plus size={14} aria-hidden />
            </button>
          </div>
          <button
            type="button"
            aria-label={`Remove local rule ${index + 1} from hole ${number}`}
            onClick={() => onChange(penalties.filter((_, i) => i !== index))}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ))}

      {penalties.length < MAX_LOCAL_RULES ? (
        <button
          type="button"
          onClick={() => onChange([...penalties, { strokes: 2, reason: "" }])}
          className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-hazard/50 text-[11px] font-bold text-hazard"
        >
          <Plus size={13} aria-hidden />
          Add a local rule
        </button>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Five is the limit — any more and nobody reads the sheet.
        </p>
      )}
    </div>
  );
}
