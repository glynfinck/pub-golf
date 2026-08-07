"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { countWord, ordinal, toParClass } from "@/lib/format";
import type { StandingRow } from "@/lib/scoring";
import { cn, formatToPar } from "@/lib/utils";

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
 */
export function PositionRibbon({ standings }: { standings: StandingRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const me = standings.find((row) => row.isYou);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        data-testid="position-ribbon"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-11 items-center justify-between rounded-xl bg-fairway px-4 text-background"
      >
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
      </button>

      {/* One gutter everywhere: the card pads the same 6px that separates
          the rows, so the shaded "you" row floats evenly whatever its rank.
          The gap is the divider — hairlines on top would be saying it twice. */}
      {expanded ? (
        <Card className="gap-1.5 px-1.5 py-1.5" data-testid="standings">
          {standings.map((row) => (
            <div
              key={row.playerId}
              className={cn(
                "flex min-h-11 items-center justify-between gap-2 rounded-lg px-2.5",
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
