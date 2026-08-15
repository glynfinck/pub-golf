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

/**
 * **Padded, because `engraved` is an inset shadow.** The frame paints on the
 * card's own background layer, so any child with something to draw paints
 * straight over it — the art covered the ring across its half of the card and
 * the border appeared to stop halfway down, reading as two cards stacked. I
 * then added a fade to disguise that seam, which washed out the first stops
 * of the walk: a second wrong thing hiding the first. Holding the content a
 * pixel inside the ring makes the frame continuous, turns the art into a
 * plate the frame goes round, and needs no fade at all — the art has no
 * background of its own, so it was always already part of the card.
 */
export function StartCards({ caddy }: { caddy: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {caddy ? (
        <Link
          href="/plan"
          data-testid="door-caddy"
          className="engraved block rounded-2xl bg-card p-1.5"
        >
          <div className="overflow-hidden rounded-[12px]">
            <TheWalk />
            <div className="flex flex-col gap-1 px-3 pt-1 pb-3">
              <span className="eyebrow text-fairway">Members</span>
              <span className="font-serif text-2xl leading-tight">
                Plan it with the caddy
              </span>
              <span className="text-xs text-muted-foreground">
                Draw where you&rsquo;re drinking on the map. The caddy walks the
                patch, routes the night and dresses every hole — pubs, pars,
                drinks and hazards.
              </span>
            </div>
          </div>
        </Link>
      ) : null}

      <Link
        href="/courses/new"
        data-testid="door-manual"
        className="engraved block rounded-2xl bg-card p-1.5"
      >
        <div className="overflow-hidden rounded-[12px]">
          <TheCard />
          <div className="flex flex-col gap-1 px-3 pt-1 pb-3">
            <span className="eyebrow">Free, always</span>
            <span className="font-serif text-2xl leading-tight">
              Plot it by hand
            </span>
            <span className="text-xs text-muted-foreground">
              Search the pubs yourself and set every par, drink and hazard the
              way your lot play it.
            </span>
          </div>
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
 * The manual card's art: the card being written.
 *
 * It was four grey bars — which is the universal shape of a *skeleton
 * loader*, so the card read as unfinished rather than as a thing anyone
 * would choose. It also copied the caddy card's strategy (diagram what you
 * get) and lost, because a map with a walk on it beats a list every time.
 * So this one sells the *act* the door is named for instead: a scorecard
 * mid-fill, the pen still on the third line.
 *
 * **Everything sits on one baseline per row**, which is the whole of why an
 * earlier attempt at this looked wrong. The handwriting is written on it,
 * the dot leader continues it exactly, and the hole numeral and the par are
 * optically centred against it — so the eye reads three ruled rows rather
 * than three drawings that happen to be near each other.
 */

/** The grid, named once so the rows cannot drift apart. */
const CARD_LEFT = 24;
const CARD_RIGHT = 296;
/** Row baselines, evenly spaced; everything in a row hangs off one of these. */
const CARD_ROWS = [48, 74, 100];
/** Where the writing starts, where the leader stops, where the par box sits. */
const WRITE_X = 48;
const LEADER_END = 254;
const PAR_X = 262;
const PAR_W = 20;
/** Cap height of the serif numerals at 12px, halved — what "optically
 * centred on the baseline" actually means for this face. */
const NUMERAL_RISE = 4;

/**
 * A run of handwriting, as a chain of upward bumps on a common baseline.
 *
 * Deterministic: the bump heights come from a fixed table rather than a
 * random source, because render must not read anything it cannot repeat —
 * the house rule that keeps `Date.now()` and `Math.random()` out of a
 * component in the first place.
 */
const BUMPS = [-8, -6, -14, -5, -7, -10, -6, -13, -5, -9, -7, -6];

function scribble(from: number, to: number, base: number, offset = 0): string {
  const step = 9;
  let path = `M${from},${base}`;
  let index = 0;
  for (let x = from; x + step <= to; x += step) {
    const rise = BUMPS[(index + offset) % BUMPS.length];
    path += ` q${step / 2},${rise} ${step},0`;
    index += 1;
  }
  return path;
}

function TheCard() {
  const rows = [
    { hole: 1, writtenTo: 158, par: "4", offset: 0 },
    // Short on purpose: a pen tall enough to read as one is taller than the
    // gap between two rows, so it *will* cross the row above. Better it
    // crosses that row's leader dots than its words.
    { hole: 2, writtenTo: 104, par: "3", offset: 5 },
    // The third is being written now: no par yet, and the pen is still on it.
    { hole: 3, writtenTo: 122, par: null, offset: 9 },
  ];
  const penAt = rows[2].writtenTo;
  const penBase = CARD_ROWS[2] + 1;

  return (
    <svg viewBox="0 0 320 120" aria-hidden className="block h-auto w-full">
      {/* The masthead's own engraving: a hairline over a double rule. */}
      <g stroke="var(--color-border)" strokeWidth="1">
        <line x1={CARD_LEFT} y1="18" x2={CARD_RIGHT} y2="18" />
        <line x1={CARD_LEFT} y1="23" x2={CARD_RIGHT} y2="23" />
        <line x1={CARD_LEFT} y1="25.5" x2={CARD_RIGHT} y2="25.5" />
      </g>

      {rows.map((row, index) => {
        const y = CARD_ROWS[index];
        // The one line everything in this row is hung from.
        const base = y + 1;
        return (
          <g key={row.hole}>
            <text
              x={CARD_LEFT + 8}
              y={base + NUMERAL_RISE - 1}
              textAnchor="middle"
              fontFamily="Georgia, serif"
              fontSize="12"
              fontWeight="700"
              fill="var(--color-fairway)"
            >
              {row.hole}
            </text>
            <path
              d={scribble(WRITE_X, row.writtenTo, base, row.offset)}
              fill="none"
              stroke="var(--color-foreground)"
              strokeWidth="1.7"
              strokeLinecap="round"
              opacity="0.72"
            />
            {/* The leader continues the writing's own baseline, which is what
                makes the row read as one ruled line rather than two. */}
            <line
              x1={row.writtenTo + 8}
              y1={base}
              x2={LEADER_END}
              y2={base}
              stroke="var(--color-border)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray="0.1 6"
            />
            <rect
              x={PAR_X}
              y={base - PAR_W / 2 - 1}
              width={PAR_W}
              height={PAR_W}
              rx="4"
              fill="none"
              stroke="var(--color-border)"
              strokeWidth="1.5"
            />
            {row.par ? (
              <text
                x={PAR_X + PAR_W / 2}
                y={base + NUMERAL_RISE - 1}
                textAnchor="middle"
                fontFamily="Georgia, serif"
                fontSize="12"
                fontWeight="700"
                fill="var(--color-foreground)"
                opacity="0.78"
              >
                {row.par}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* The pen, tip on the third line exactly where the writing stopped.
          Drawn nib-first from the origin, so the tip lands on the baseline
          however the barrel is leant.

          **Haloed.** A pen tall enough to read as one is taller than the gap
          between two rows, so it crosses the row above whatever we do — the
          card-coloured outline underneath cuts a clean gap through what it
          crosses, which is how an illustration says "in front" rather than
          "muddled". */}
      <g transform={`translate(${penAt}, ${penBase}) rotate(32)`}>
        <g
          stroke="var(--color-card)"
          strokeWidth="3.5"
          strokeLinejoin="round"
          fill="var(--color-card)"
        >
          <rect x="-4" y="-40" width="8" height="27" rx="3" />
          <path d="M0,0 L-3.4,-13 L3.4,-13 Z" />
        </g>
        <rect
          x="-4"
          y="-40"
          width="8"
          height="27"
          rx="3"
          fill="var(--color-fairway)"
        />
        <rect
          x="-4.4"
          y="-14.6"
          width="8.8"
          height="2.6"
          fill="var(--color-border)"
        />
        <path d="M0,0 L-3.4,-13 L3.4,-13 Z" fill="var(--color-marker)" />
        <line
          x1="0"
          y1="-3"
          x2="0"
          y2="-8.5"
          stroke="var(--color-card)"
          strokeWidth="1.1"
        />
      </g>
    </svg>
  );
}

export function StartHint({ className }: { className?: string }) {
  return (
    <p
      className={cn("text-center text-[11px] text-muted-foreground", className)}
    >
      Either way the course is yours to edit afterwards, and every round takes
      its own snapshot.
    </p>
  );
}
