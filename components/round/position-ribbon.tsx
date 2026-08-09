"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { countWord, ordinal, toParClass } from "@/lib/format";
import type { StandingRow } from "@/lib/scoring";
import { cn, formatToPar } from "@/lib/utils";

/** How long the ribbon calls a mulligan before going back to business. */
const MULLIGAN_FLASH_MS = 5_000;

/**
 * "level with Soph" | "one behind Soph" | "two clear of Soph"
 *
 * Measured on netToPar, which is what the rows beside it are ordered by —
 * a gap quoted in gross would contradict the very list it describes.
 */
function gapPhrase(rows: StandingRow[], me: StandingRow) {
  const myIndex = rows.findIndex((row) => row.playerId === me.playerId);
  if (rows.length < 2) return "a quiet round of one";
  if (myIndex === 0) {
    const chaser = rows[1];
    const lead = chaser.netToPar - me.netToPar;
    return lead === 0
      ? `level with ${chaser.name}`
      : `${countWord(lead)} clear of ${chaser.name}`;
  }
  const ahead = rows[myIndex - 1];
  const gap = me.netToPar - ahead.netToPar;
  return gap === 0
    ? `level with ${ahead.name}`
    : `${countWord(gap)} behind ${ahead.name}`;
}

/**
 * One line of standing that expands to the full card on tap — the play
 * screen shows position, not a table, until you ask.
 *
 * The ribbon also calls a mulligan to the table: a score falling to zero
 * with no explanation reads as a glitch, so when anyone's mulligan count
 * rises the strip rings amber and says who, then goes back to business.
 * The expanded card keeps the permanent record as an ↺ ×N mark.
 */
export function PositionRibbon({ standings }: { standings: StandingRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const me = standings.find((row) => row.isYou);

  // Who most recently took a mulligan, while the ribbon is calling it.
  const [mulliganCall, setMulliganCall] = useState<string | null>(null);
  const prevCounts = useRef<Map<string, number> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => {
    const next = new Map(standings.map((row) => [row.playerId, row.mulligans]));
    const prev = prevCounts.current;
    prevCounts.current = next;
    // First render is the baseline, not an event — a reload mid-round must
    // not re-announce every mulligan already on the card.
    if (!prev) return;
    const taker = standings.find(
      (row) => row.mulligans > (prev.get(row.playerId) ?? 0),
    );
    if (!taker) return;
    setMulliganCall(taker.name);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(
      () => setMulliganCall(null),
      MULLIGAN_FLASH_MS,
    );
  }, [standings]);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        data-testid="position-ribbon"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          "flex min-h-11 items-center justify-between rounded-xl bg-fairway px-4 text-background",
          mulliganCall && "outline-2 -outline-offset-1 outline-marker",
        )}
      >
        {mulliganCall ? (
          <>
            <span className="flex items-center gap-1.5 text-sm font-bold">
              <RotateCcw size={14} aria-hidden />
              Mulligan
            </span>
            <span className="font-serif text-base">
              {mulliganCall} starts the hole again
            </span>
          </>
        ) : (
          <>
            <span className="text-sm">
              {me ? `${ordinal(me.rank)} on the card` : "The card so far"}
            </span>
            <span className="flex items-center gap-1.5 font-serif text-base">
              {me ? gapPhrase(standings, me) : `${standings.length} playing`}
              <ChevronDown
                size={15}
                aria-hidden
                className={cn("transition-transform", expanded && "rotate-180")}
              />
            </span>
          </>
        )}
      </button>

      {/* The rows own every edge of the card, so the row you are on fills its
          slot completely — no card padding peeking above or below it as a
          stray strip. overflow-hidden on the card clips the top and bottom
          rows to the rounded corners. */}
      {expanded ? (
        <Card className="gap-0 py-0" data-testid="standings">
          {standings.map((row, index) => (
            <div
              key={row.playerId}
              className={cn(
                "flex min-h-11 items-center justify-between px-5",
                index > 0 && !row.isYou && "border-t border-border",
                row.isYou && "bg-secondary",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="tabular w-5 font-mono text-xs text-muted-foreground">
                  {row.rank}
                </span>
                <Avatar name={row.name} className="size-6 text-[10px]" />
                <b className="text-sm">{row.name}</b>
                {row.isYou ? (
                  <span className="text-[10px] text-muted-foreground">you</span>
                ) : null}
                {row.mulligans > 0 ? (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-marker/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-marker">
                    <RotateCcw size={9} aria-hidden />×{row.mulligans}
                  </span>
                ) : null}
              </span>
              <span className="tabular font-mono text-sm">
                <b>{row.handicap > 0 ? row.net : row.gross}</b>{" "}
                <span className={cn("font-bold", toParClass(row.netToPar))}>
                  {formatToPar(row.netToPar)}
                </span>
              </span>
            </div>
          ))}
        </Card>
      ) : null}
    </div>
  );
}
