import { projectRoute, routePath, type PreviewStop } from "@/lib/route-preview";
import { cn } from "@/lib/utils";

/**
 * The walk, drawn small and always on.
 *
 * The card is a list, and a list cannot answer "is this a walk or a scatter?".
 * The map sheet can, but it is a tap and a sheet away, so the shape lives at
 * the top of the drafting table instead — visible the whole time you are
 * editing, and changing under you as you edit.
 *
 * It draws **only the chosen pubs**, numbered in walking order. Not a search
 * result, not a basemap, no tiles and no browser key: it is a diagram of the
 * card rather than a map of the area, which is also why it stays honest about
 * what it is. Legs are straight lines because they describe the *order*, not
 * the streets — `PubMapSheet` is still where you go to see the real thing.
 *
 * The frame is sized by the route (`lib/route-preview.ts`), so a crawl up one
 * street gets a wide short box and a wander round a quarter gets a squarer one.
 */
export function RoutePreview({
  stops,
  className,
}: {
  stops: PreviewStop[];
  className?: string;
}) {
  const preview = projectRoute(stops);
  // One pin is not a route, and neither is a card of pubs added by name. No
  // frame, no empty box, no apology — the same absence the maps key already
  // uses when it is missing.
  if (!preview) return null;

  const { width, height, points } = preview;
  const last = points.length - 1;

  return (
    <figure
      className={cn("engraved rounded-xl bg-card px-3 py-3", className)}
      data-testid="route-preview"
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`The walk, ${points.length} ${points.length === 1 ? "hole" : "holes"} in order`}
      >
        {/* The walk. Drawn under the pins so a leg never crosses a number. */}
        <path
          d={routePath(points)}
          fill="none"
          stroke="var(--color-fairway)"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="3 2.5"
          opacity={0.65}
        />
        {points.map((point, i) => (
          <g key={point.hole}>
            <circle
              cx={point.x}
              cy={point.y}
              r={5.2}
              // The last hole wears the marker gold, the way the card's own
              // furniture already marks where a round finishes.
              fill={i === last ? "var(--color-marker)" : "var(--color-fairway)"}
            />
            <text
              x={point.x}
              y={point.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={5.6}
              fontWeight={600}
              fill="var(--color-card)"
            >
              {point.hole}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}
