"use client";

import { Minus, Plus, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { FieldLabel, Input } from "@/components/ui/input";

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
    </Card>
  );
}
