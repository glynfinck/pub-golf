import type { StandingRow, Superlatives } from "@/lib/scoring";
import type { Tables } from "@/types/supabase-helpers";
import { cn, formatToPar } from "@/lib/utils";

/**
 * The shareable recap: always rendered on cream stock (.theme-cream
 * re-asserts the daylight tokens), whatever theme the app is in — this is
 * the screenshot that goes to the group chat.
 */
export function RecapCard({
  round,
  holeCount,
  par,
  standings,
  superlatives,
}: {
  round: Tables<"rounds">;
  holeCount: number;
  par: number;
  standings: StandingRow[];
  superlatives: Superlatives;
}) {
  const date = new Date(round.created_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="theme-cream rounded-2xl border-[1.5px] border-foreground/40 bg-background p-5 text-foreground">
      <div className="rule-double" aria-hidden />
      <div className="mt-4 text-center">
        <div className="font-serif text-2xl italic">{round.name}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {date} · {holeCount} holes · par {par}
        </div>
      </div>

      <div className="mt-4 flex flex-col">
        {standings.map((row) => (
          <div
            key={row.playerId}
            className="flex min-h-8 items-baseline gap-2 text-sm"
          >
            <span
              className={cn(
                "min-w-0 truncate",
                row.rank === 1 && "font-bold text-fairway",
              )}
            >
              {row.rank === 1 ? <span className="text-marker">★ </span> : null}
              {row.name}
            </span>
            <span aria-hidden className="leader flex-1 self-center" />
            <span className="tabular shrink-0 font-mono text-xs">
              <b>{row.gross}</b> · {formatToPar(row.toPar)}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        {superlatives.mostHazarded ? (
          <div className="flex-1 rounded-lg border border-foreground/40 bg-card px-2 py-2 text-center">
            <div className="eyebrow text-[8px]">Most hazarded</div>
            <div className="font-serif text-sm italic">
              {superlatives.mostHazarded.name}
            </div>
          </div>
        ) : null}
        {superlatives.bestHole ? (
          <div className="flex-1 rounded-lg border border-foreground/40 bg-card px-2 py-2 text-center">
            <div className="eyebrow text-[8px]">Best hole</div>
            <div className="truncate font-serif text-sm italic">
              {superlatives.bestHole.venue}
            </div>
          </div>
        ) : null}
        {superlatives.steadiest ? (
          <div className="flex-1 rounded-lg border border-foreground/40 bg-card px-2 py-2 text-center">
            <div className="eyebrow text-[8px]">Steadiest hand</div>
            <div className="font-serif text-sm italic">
              {superlatives.steadiest.name}
            </div>
          </div>
        ) : null}
      </div>

      <p className="mt-4 text-center font-serif text-[11px] italic text-muted-foreground">
        A card is a bit of fun, not a contract.
      </p>
    </div>
  );
}
