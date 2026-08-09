import { PENNANT_PATH, STICK_PATH, STICK_WIDTH } from "@/lib/mark";
import { cn } from "@/lib/utils";

/**
 * The putt — the house busy mark, shown beside pending copy once a wait
 * has earned furniture (useAction's `busy`). The leader dots become the
 * green, the flag is the house mark's own geometry (lib/mark.ts, the
 * favicon's flag), and the ball rolls the text baseline toward the cup:
 * dies at the lip, hangs a beat, drops. Keyframes live in globals.css.
 *
 * Inked entirely in currentColor so it follows the label it waits beside —
 * on the dark theme's primary button the pennant's orange would vanish
 * into the ground it scores on.
 */
export function Putt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 72 24"
      width={54}
      height={18}
      aria-hidden
      // -mb-[3px] puts the ground line on the text baseline (a replaced
      // element's baseline is its bottom margin edge); size-auto keeps
      // Button's default svg sizing from squaring the mark.
      className={cn("size-auto shrink-0 -mb-[3px]", className)}
    >
      <g fill="currentColor" opacity={0.45}>
        {Array.from({ length: 7 }, (_, i) => (
          <circle key={i} cx={2 + i * 8} cy={20} r={1.2} />
        ))}
      </g>
      {/* The flag at favicon geometry, rescaled to plant at the cup with
          the pennant just inside the frame. */}
      <g transform="translate(49.2 -2.4) scale(0.9)">
        <path
          d={STICK_PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth={STICK_WIDTH}
          strokeLinecap="round"
        />
        <path d={PENNANT_PATH} fill="currentColor" className="putt-pennant" />
      </g>
      <circle className="putt-ball" cx={4} cy={17.4} r={2.5} fill="currentColor" />
    </svg>
  );
}

/**
 * The full green — the putt grown to the width of its container, for the
 * one screen whose whole job is waiting (the rescue screen's "held at the
 * door" panel). Edge to edge the leader dots stop being an ornament and
 * become the panel's baseline, the same move as a dot-leader row: dots
 * running out to meet the flag planted at the right margin. The roll is
 * longer and a touch slower than the small putt's — this wait is seconds,
 * not milliseconds, and it should read patient rather than busy.
 *
 * Same drawing as Putt at the same 8-unit dot pitch; only the distance
 * differs, so the keyframes (globals.css, beside the putt's) carry their
 * own roll length.
 */
export function PuttGreen({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 244 24"
      aria-hidden
      className={cn("block w-full", className)}
    >
      <g fill="currentColor" opacity={0.45}>
        {Array.from({ length: 28 }, (_, i) => (
          <circle key={i} cx={2 + i * 8} cy={20} r={1.2} />
        ))}
      </g>
      {/* The flag at favicon geometry, planted the same 12 units in from
          the right edge as the small putt's. */}
      <g transform="translate(221.2 -2.4) scale(0.9)">
        <path
          d={STICK_PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth={STICK_WIDTH}
          strokeLinecap="round"
        />
        <path
          d={PENNANT_PATH}
          fill="currentColor"
          className="putt-green-pennant"
        />
      </g>
      <circle
        className="putt-green-ball"
        cx={4}
        cy={17.4}
        r={2.5}
        fill="currentColor"
      />
    </svg>
  );
}
