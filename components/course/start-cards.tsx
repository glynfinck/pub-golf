import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The two ways to make a course, as two cards you choose between.
 *
 * They were a button and a button, stacked, which made the paid one read as
 * a variant of the free one. They are not variants: one is a map you draw a
 * walk on and one is a list you fill in by hand, and the whole point of this
 * screen is that you pick a *room* before you start rather than discovering
 * the other one bolted above the form.
 *
 * No prices anywhere. The caddy card says it is the members' part — the
 * disclosure without the pitch — and the number arrives with a refusal, one
 * tap away, on a sheet with a door in it. That is the covenant's own order.
 *
 * Server-rendered: the animation is CSS on inline SVG, so the card that
 * makes the case for the paid feature costs the page no JavaScript at all.
 */

/** How long after the walk starts drawing each stop lands. Matched to the
 * mask's own 1.7s sweep, so a pin arrives as the line reaches it. */
const STOP_DELAYS = [0.15, 0.5, 0.85, 1.2, 1.5];

const STOPS = [
  { x: 36, y: 92 },
  { x: 92, y: 72 },
  { x: 148, y: 80 },
  { x: 210, y: 50 },
  { x: 276, y: 32 },
];

export function StartCards({ caddy }: { caddy: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {caddy ? (
        <Link
          href="/plan"
          data-testid="door-caddy"
          className="engraved block overflow-hidden rounded-2xl bg-card"
        >
          <div className="relative">
            <TheWalk />
            {/* The art fades into the card rather than stopping at a hard
                edge — the join is the only place a picture and a page meet. */}
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent"
            />
          </div>
          <div className="flex flex-col gap-1 px-4 pt-1 pb-4">
            <span className="eyebrow text-fairway">Members</span>
            <span className="font-serif text-2xl leading-tight">
              Plan it with the caddy
            </span>
            <span className="text-[13px] text-muted-foreground">
              Draw where you&rsquo;re drinking on the map. The caddy walks the
              patch, routes the night and dresses every hole — pubs, pars,
              drinks and hazards.
            </span>
          </div>
        </Link>
      ) : null}

      <Link
        href="/courses/new"
        data-testid="door-manual"
        className="engraved block overflow-hidden rounded-2xl bg-card"
      >
        <div className="relative">
          <TheCard />
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent"
          />
        </div>
        <div className="flex flex-col gap-1 px-4 pt-1 pb-4">
          <span className="eyebrow">Free, always</span>
          <span className="font-serif text-2xl leading-tight">
            Plot it by hand
          </span>
          <span className="text-[13px] text-muted-foreground">
            Search the pubs yourself and set every par, drink and hazard the
            way your lot play it.
          </span>
        </div>
      </Link>
    </div>
  );
}

/** The caddy card's art: a walk drawing itself across a patch. */
function TheWalk() {
  const line = STOPS.map((stop) => `${stop.x},${stop.y}`).join(" ");
  return (
    /* Width-driven, height following the viewBox. `slice` on a fixed height
       scales art to *cover* its box, which cropped the walk and sheared the
       scorecard rows off — letting the aspect ratio set the height is the
       only way a drawing of a fixed thing stays whole at every width. */
    <svg viewBox="0 0 320 120" aria-hidden className="block h-auto w-full">
      <defs>
        {/* The reveal: a rect that grows left to right, wiping the dotted
            walk into view without disturbing its dots — a stroke-dashoffset
            draw cannot keep a dash pattern it is already using. */}
        <mask id="start-walk-reveal">
          <rect
            x="0"
            y="0"
            width="320"
            height="120"
            fill="white"
            className="start-walk-mask"
          />
        </mask>
      </defs>

      {/* The patch: streets, then the pubs the caddy did not pick. */}
      <g stroke="var(--color-border)" strokeWidth="1" opacity="0.5">
        <line x1="0" y1="30" x2="320" y2="40" />
        <line x1="0" y1="70" x2="320" y2="60" />
        <line x1="0" y1="108" x2="320" y2="116" />
        <line x1="70" y1="0" x2="58" y2="120" />
        <line x1="172" y1="0" x2="184" y2="120" />
        <line x1="256" y1="0" x2="246" y2="120" />
      </g>
      <g fill="var(--color-muted-foreground)" opacity="0.26">
        <circle cx="60" cy="44" r="2.4" />
        <circle cx="120" cy="106" r="2.4" />
        <circle cx="184" cy="96" r="2.4" />
        <circle cx="238" cy="80" r="2.4" />
        <circle cx="292" cy="92" r="2.4" />
        <circle cx="102" cy="34" r="2.4" />
      </g>

      <g mask="url(#start-walk-reveal)">
        <polyline
          points={line}
          fill="none"
          stroke="var(--color-fairway)"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeDasharray="0.1 9"
        />
      </g>

      {STOPS.map((stop, index) => {
        const last = index === STOPS.length - 1;
        return (
          <g
            key={index}
            className="start-stop"
            style={{ animationDelay: `${STOP_DELAYS[index]}s` }}
          >
            {last ? (
              <circle
                cx={stop.x}
                cy={stop.y}
                r="10"
                fill="var(--color-marker)"
                className="start-glow"
              />
            ) : null}
            <circle
              cx={stop.x}
              cy={stop.y}
              r="9.5"
              fill={last ? "var(--color-marker)" : "var(--color-fairway)"}
              stroke="var(--color-card)"
              strokeWidth="2"
            />
            <text
              x={stop.x}
              y={stop.y + 3.4}
              textAnchor="middle"
              fontFamily="Georgia, serif"
              fontSize="10"
              fontWeight="700"
              fill="var(--color-background)"
            >
              {index + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The manual card's art: the printed scorecard itself.
 *
 * It was four grey bars, which said "a list" and nothing else — and being
 * `slice`-scaled, half of them were cut off the card anyway. This draws the
 * thing the drafting table actually makes: the engraved double rule, holes
 * in their numbered rings, a dot leader out to a par box, and a last row
 * left blank, because what the free table gives you is the blank one.
 */
function TheCard() {
  const rows = [
    { hole: 1, width: 104, par: "4" },
    { hole: 2, width: 86, par: "3" },
    { hole: 3, width: 0, par: "" },
  ];
  return (
    <svg viewBox="0 0 320 120" aria-hidden className="block h-auto w-full">
      {/* The masthead's own engraving: a hairline over a double rule. */}
      <g stroke="var(--color-border)">
        <line x1="24" y1="18" x2="296" y2="18" strokeWidth="1" />
        <line x1="24" y1="23" x2="296" y2="23" strokeWidth="1" />
        <line x1="24" y1="25.5" x2="296" y2="25.5" strokeWidth="1" />
      </g>

      {rows.map((row, index) => {
        const y = 50 + index * 30;
        return (
          <g key={row.hole}>
            <circle
              cx="38"
              cy={y}
              r="10"
              fill="none"
              stroke="var(--color-fairway)"
              strokeWidth="1.5"
            />
            <text
              x="38"
              y={y + 3.6}
              textAnchor="middle"
              fontFamily="Georgia, serif"
              fontSize="11"
              fontWeight="700"
              fill="var(--color-fairway)"
            >
              {row.hole}
            </text>
            {row.width > 0 ? (
              <rect
                x="58"
                y={y - 5}
                width={row.width}
                height="10"
                rx="3"
                fill="var(--color-secondary)"
              />
            ) : null}
            {/* The dot leader, menu style — the same fill the house's own
                `leader` utility paints between a label and its value. */}
            <line
              x1={58 + row.width + (row.width > 0 ? 10 : 0)}
              y1={y + 1}
              x2="252"
              y2={y + 1}
              stroke="var(--color-border)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray="0.1 6"
            />
            <rect
              x="264"
              y={y - 10}
              width="20"
              height="20"
              rx="4"
              fill="none"
              stroke="var(--color-border)"
              strokeWidth="1.5"
            />
            {row.par ? (
              <text
                x="274"
                y={y + 3.6}
                textAnchor="middle"
                fontFamily="Georgia, serif"
                fontSize="11"
                fontWeight="700"
                fill="var(--color-muted-foreground)"
              >
                {row.par}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/** Shared by both cards; exported for the tests that pin the doors. */
export const START_DOORS = ["door-caddy", "door-manual"] as const;

export function StartHint({ className }: { className?: string }) {
  return (
    <p className={cn("text-center text-[11px] text-muted-foreground", className)}>
      Either way the course is yours to edit afterwards, and every round takes
      its own snapshot.
    </p>
  );
}
