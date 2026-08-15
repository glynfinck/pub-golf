"use client";

import {
  FIRST_TEE_MINUTES,
  LAST_TEE_MINUTES,
  nudgeTeeOff,
  TEE_MINUTE_STEP,
} from "@/lib/caddy/tee-off";
import { clockTime12 } from "@/lib/time";
import { cn } from "@/lib/utils";

const down =
  "flex h-9 min-w-9 shrink-0 items-center justify-center rounded-md px-1 font-mono text-[11px] font-bold text-muted-foreground hover:bg-secondary disabled:opacity-30";
const up =
  "flex h-9 min-w-9 shrink-0 items-center justify-center rounded-md px-1 font-mono text-[11px] font-bold text-fairway hover:bg-secondary disabled:opacity-30";

/**
 * One readout, four nudges: any time of day on the quarter hour, with hour
 * jumps still one tap away.
 *
 * Lifted out of the round-creation form, which has had it since launch, for
 * the screen that did not: the caddy's brief offered four evening chips, so a
 * round teeing off at noon was unaskable there and ordinary one screen over.
 * Two controls for one question is how they came to disagree, so now there is
 * one — and the tee-off is not decoration on the brief, it is what decides
 * which pubs are open enough to be on the card at all.
 *
 * Deliberately not `<input type="time">`: the native picker is a modal wheel
 * on the two platforms that matter, which is a long way to go to move a tee by
 * fifteen minutes, and it renders differently in every browser. Four buttons
 * and a tabular readout are the same everywhere and are already the house's
 * idiom for a number a thumb adjusts.
 */
export function TeeTimeNudger({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // `min-w-max` for the reason `Stepper` documents: four shrink-0 buttons
        // and a flex-1 readout in a caller-set width means the *readout* pays
        // for the squeeze. At w-52 it got 42px for a 56px value and wrapped
        // "7:00 PM" onto two lines — at the default value, on every phone.
        "flex min-h-12 min-w-max items-center gap-0.5 rounded-lg border border-input bg-card px-1.5",
        className,
      )}
    >
      <button
        type="button"
        aria-label="Tee off an hour earlier"
        disabled={value <= FIRST_TEE_MINUTES}
        onClick={() => onChange(nudgeTeeOff(value, -60))}
        className={down}
      >
        −1h
      </button>
      <button
        type="button"
        aria-label="Tee off a quarter hour earlier"
        disabled={value <= FIRST_TEE_MINUTES}
        onClick={() => onChange(nudgeTeeOff(value, -TEE_MINUTE_STEP))}
        className={down}
      >
        −15
      </button>
      <span
        className="tabular min-w-0 flex-1 text-center font-mono text-sm font-bold"
        data-testid="tee-time"
      >
        {clockTime12(value)}
      </span>
      <button
        type="button"
        aria-label="Tee off a quarter hour later"
        disabled={value >= LAST_TEE_MINUTES}
        onClick={() => onChange(nudgeTeeOff(value, TEE_MINUTE_STEP))}
        className={up}
      >
        +15
      </button>
      <button
        type="button"
        aria-label="Tee off an hour later"
        disabled={value >= LAST_TEE_MINUTES}
        onClick={() => onChange(nudgeTeeOff(value, 60))}
        className={up}
      >
        +1h
      </button>
    </div>
  );
}
