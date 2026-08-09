"use client";

import { Fragment } from "react";
import { LocalRulesHeading } from "@/components/round/local-rules-heading";
import { DotLeaderRow } from "@/components/ui/dot-leader";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { RoundBundle } from "@/lib/data/rounds";
import { hazardsOn } from "@/lib/hazards";
import { penaltyOptions } from "@/lib/penalty-options";
import { roundRuleLines } from "@/lib/round-rules";
import { readHolePenalties, readRuleset } from "@/lib/ruleset";

/** A section label in the sheet — LocalRulesHeading's shape, house-green. */
function SheetHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-2 pb-1">
      <span className="eyebrow text-fairway">{children}</span>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * The rules bottom sheet, behind the masthead's help mark: how the game
 * plays, what this round has on its card, and the penalty tariff.
 *
 * It reads, it does not act — penalties are CALLED from the penalty sheet,
 * where the undo lives. Two doors onto the same write is how a table
 * double-books a spill at 11pm. It also spells out the two scoring rules
 * that look like bugs to anyone who has not read lib/scoring.ts: the
 * no-swig substitute, and what a mulligan does and does not buy.
 */
export function RulesSheet({
  open,
  onOpenChange,
  round,
  holes,
  hole,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  round: RoundBundle["round"];
  holes: RoundBundle["holes"];
  /** The hole whose local rules join the house tariff, if the screen is on one. */
  hole?: number;
}) {
  const ruleset = readRuleset(round.ruleset);
  const lines = roundRuleLines(ruleset, holes);
  const hazardsInPlay = ruleset.hazards ? hazardsOn(holes) : [];
  const holeRow =
    hole != null ? holes.find((h) => h.number === hole) : undefined;
  const options = penaltyOptions(
    ruleset.penalties,
    holeRow ? readHolePenalties(holeRow.penalties) : [],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-md rounded-t-2xl"
        data-testid="rules-sheet"
      >
        <SheetHeader className="pb-0 text-center">
          <SheetTitle
            className="eyebrow text-center text-foreground"
            style={{ textIndent: "0.2em" }}
          >
            House rules · {round.name}
          </SheetTitle>
          <SheetDescription className="text-center text-xs">
            The card as agreed at the first tee.
          </SheetDescription>
        </SheetHeader>

        <div className="flex max-h-[70svh] flex-col overflow-y-auto px-4 pb-6">
          <SheetHeading>How it plays</SheetHeading>
          <p className="text-xs text-muted-foreground">
            Every hole is a pub and the drink is the ball: a swig is a stroke,
            and the lowest card wins. The caddy calls the hole — drink at your
            own pace.
          </p>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-[11px] text-muted-foreground">
            <li>
              A filed hole with no swigs scores the substitute —{" "}
              {ruleset.softSubstituteScoresPar ? "par" : "double par"}, never a
              free under-par hole.
            </li>
            {ruleset.mulligans > 0 ? (
              <li>
                A mulligan wipes the hole for +{ruleset.mulliganStrokes}{" "}
                and the drink starts again.
              </li>
            ) : null}
            {ruleset.handicaps ? (
              <li>
                Handicaps come off gross to give net, and net is what the
                round is won on.
              </li>
            ) : null}
          </ul>

          {/* Golf's names, borrowed for the shape of the trouble they
              cause. Only the hazards actually in force on this course get a
              line — a rule nobody is playing is just noise on a sheet read
              in a dark pub. */}
          {hazardsInPlay.length > 0 ? (
            <>
              <SheetHeading>Hazards</SheetHeading>
              <div className="flex flex-col gap-2">
                {hazardsInPlay.map(({ hazard, holeNumbers }) => (
                  <div key={hazard.id}>
                    <b className="text-xs text-hazard">
                      {hazard.label}
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        hole{holeNumbers.length > 1 ? "s" : ""}{" "}
                        {holeNumbers.join(" · ")}
                      </span>
                    </b>
                    <p className="text-[11px] text-muted-foreground">
                      {hazard.meaning}
                    </p>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <SheetHeading>This round</SheetHeading>
          <div className="flex flex-col gap-1.5">
            {lines.map((line) => (
              <DotLeaderRow
                key={line.id}
                label={line.label}
                value={line.value}
                className="text-xs"
              />
            ))}
          </div>

          <div className="flex items-center gap-2 pt-3 pb-1">
            <span className="eyebrow text-hazard">
              Penalties{holeRow ? ` · hole ${holeRow.number}` : ""}
            </span>
            <span aria-hidden className="h-px flex-1 bg-hazard/25" />
          </div>
          <div className="flex flex-col gap-1.5">
            {options.map((option, index) => {
              const opensLocalRules =
                option.scope === "hole" && options[index - 1]?.scope !== "hole";
              return (
                <Fragment key={option.reason}>
                  {opensLocalRules ? <LocalRulesHeading /> : null}
                  <DotLeaderRow
                    label={option.reason}
                    value={
                      <b className="tabular font-mono text-[11px] text-hazard">
                        +{option.strokes}
                      </b>
                    }
                    className="text-xs"
                  />
                </Fragment>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            The tariff, not the till — penalties go on the card from the
            Penalties button on the hole.
          </p>

          <p className="mt-3 text-center font-serif text-xs italic text-muted-foreground">
            A card is a bit of fun, not a contract.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
