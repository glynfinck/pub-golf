import { cn } from "@/lib/utils";

/**
 * The 1..N hole strip: filed holes filled fairway, the live hole ringed
 * marker, upcoming holes dim. `viewing` (marker's roam) reads cream —
 * the strongest state, since it's what the caddy is editing.
 */
export function HoleStrip({
  holeNumbers,
  currentHole,
  viewingHole,
  onSelect,
}: {
  holeNumbers: number[];
  currentHole: number;
  viewingHole?: number;
  onSelect?: (hole: number) => void;
}) {
  return (
    <div className="flex gap-1.5" aria-label="Holes">
      {holeNumbers.map((n) => {
        const state =
          viewingHole === n && viewingHole !== currentHole
            ? "viewing"
            : n === currentHole
              ? "live"
              : n < currentHole
                ? "done"
                : "upcoming";
        const className = cn(
          "tabular flex h-7 flex-1 items-center justify-center rounded-md font-mono text-[11px] font-bold",
          state === "done" && "bg-fairway text-background",
          state === "live" &&
            "text-marker outline-2 -outline-offset-1 outline-marker",
          state === "viewing" && "bg-foreground text-background",
          state === "upcoming" && "border border-border text-muted-foreground",
          onSelect && "min-h-7",
        );
        return onSelect ? (
          <button
            key={n}
            type="button"
            aria-label={`Review hole ${n}`}
            aria-current={n === viewingHole ? "true" : undefined}
            onClick={() => onSelect(n)}
            className={className}
          >
            {n}
          </button>
        ) : (
          <span key={n} className={className}>
            {n}
          </span>
        );
      })}
    </div>
  );
}
