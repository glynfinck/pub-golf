import type { StandingRow } from "@/lib/scoring";
import { cn, formatToPar } from "@/lib/utils";

function Column({
  row,
  place,
  height,
}: {
  row?: StandingRow;
  place: number;
  height: string;
}) {
  if (!row) return <div className="flex-1" />;
  return (
    <div className="flex flex-1 flex-col items-center justify-end gap-1.5">
      <div className="font-serif text-base italic">{row.name}</div>
      <div className="tabular font-mono text-[11px] text-muted-foreground">
        {row.gross} · {formatToPar(row.toPar)}
      </div>
      <div
        className={cn(
          "flex w-full items-start justify-center rounded-t-lg bg-secondary pt-2",
          place === 1 &&
            "bg-gradient-to-b from-marker/35 to-secondary shadow-[inset_0_2px_0_var(--color-marker)]",
        )}
        style={{ height }}
      >
        <span
          className={cn(
            "font-serif text-lg",
            place === 1 ? "text-marker" : "text-muted-foreground",
          )}
        >
          {place}
        </span>
      </div>
    </div>
  );
}

/** The ceremony: 2nd · 1st · 3rd, winner's column tallest and gilt. */
export function Podium({ standings }: { standings: StandingRow[] }) {
  return (
    <div className="flex items-end gap-2">
      <Column row={standings[1]} place={2} height="3.5rem" />
      <Column row={standings[0]} place={1} height="5.25rem" />
      <Column row={standings[2]} place={3} height="2.5rem" />
    </div>
  );
}
