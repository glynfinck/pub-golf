import {
  GREEN,
  GREEN_WIDTH,
  MARK_VIEWBOX,
  PENNANT_PATH,
  STICK_PATH,
  STICK_WIDTH,
} from "@/lib/mark";
import { cn } from "@/lib/utils";

/**
 * The house mark, in the app.
 *
 * Same geometry as the favicon and the Open Graph cards — the paths come from
 * `lib/mark.ts` so the three cannot drift — but inked with the semantic tokens
 * rather than literals, because in here we can have them and the mark should
 * turn with the theme.
 */
export function ParlourMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
      className={cn("size-9", className)}
      fill="none"
      aria-hidden
    >
      <ellipse
        cx={GREEN.cx}
        cy={GREEN.cy}
        rx={GREEN.rx}
        ry={GREEN.ry}
        stroke="var(--fairway)"
        strokeWidth={GREEN_WIDTH}
      />
      <path
        d={STICK_PATH}
        stroke="var(--fairway)"
        strokeWidth={STICK_WIDTH}
        strokeLinecap="round"
      />
      <path d={PENNANT_PATH} fill="var(--marker)" />
    </svg>
  );
}
