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
  { x: 38, y: 116 },
  { x: 92, y: 92 },
  { x: 146, y: 100 },
  { x: 208, y: 66 },
  { x: 272, y: 44 },
];

export function StartCards({ caddy }: { caddy: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {caddy ? (
        <Link
          href="/plan"
          data-testid="door-caddy"
          className="engraved group relative block overflow-hidden rounded-2xl bg-card"
        >
          <TheWalk />
          <div className="relative flex flex-col gap-1 bg-gradient-to-t from-card via-card/95 to-transparent px-4 pt-8 pb-4">
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
        className="engraved relative block overflow-hidden rounded-2xl bg-card"
      >
        <TheCard />
        <div className="relative flex flex-col gap-1 bg-gradient-to-t from-card via-card/95 to-transparent px-4 pt-8 pb-4">
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
    <svg
      viewBox="0 0 320 150"
      aria-hidden
      className="block h-40 w-full"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        {/* The reveal: a rect that grows left to right, wiping the dotted
            walk into view without disturbing its dots — a stroke-dashoffset
            draw cannot keep a dash pattern it is already using. */}
        <mask id="start-walk-reveal">
          <rect
            x="0"
            y="0"
            width="320"
            height="150"
            fill="white"
            className="start-walk-mask"
          />
        </mask>
      </defs>

      {/* The patch: streets, then the pubs the caddy did not pick. */}
      <g stroke="var(--color-border)" strokeWidth="1" opacity="0.5">
        <line x1="0" y1="40" x2="320" y2="52" />
        <line x1="0" y1="86" x2="320" y2="74" />
        <line x1="0" y1="132" x2="320" y2="142" />
        <line x1="70" y1="0" x2="58" y2="150" />
        <line x1="172" y1="0" x2="184" y2="150" />
        <line x1="256" y1="0" x2="246" y2="150" />
      </g>
      <g fill="var(--color-muted-foreground)" opacity="0.28">
        <circle cx="64" cy="58" r="2.6" />
        <circle cx="122" cy="132" r="2.6" />
        <circle cx="186" cy="118" r="2.6" />
        <circle cx="242" cy="98" r="2.6" />
        <circle cx="290" cy="112" r="2.6" />
        <circle cx="104" cy="46" r="2.6" />
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
                r="11"
                fill="var(--color-marker)"
                className="start-glow"
              />
            ) : null}
            <circle
              cx={stop.x}
              cy={stop.y}
              r="10"
              fill={last ? "var(--color-marker)" : "var(--color-fairway)"}
              stroke="var(--color-card)"
              strokeWidth="2"
            />
            <text
              x={stop.x}
              y={stop.y + 3.5}
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

/** The manual card's art: the printed scorecard's own ruled lines. */
function TheCard() {
  return (
    <svg
      viewBox="0 0 320 150"
      aria-hidden
      className="block h-32 w-full"
      preserveAspectRatio="xMidYMid slice"
    >
      {[0, 1, 2, 3].map((row) => (
        <g key={row}>
          <rect
            x="24"
            y={22 + row * 30}
            width={row === 2 ? 168 : 216}
            height="13"
            rx="3"
            fill="var(--color-secondary)"
          />
          <circle
            cx="248"
            cy={28 + row * 30}
            r="7"
            fill="none"
            stroke="var(--color-border)"
            strokeWidth="1.5"
          />
          <line
            x1="24"
            y1={44 + row * 30}
            x2="296"
            y2={44 + row * 30}
            stroke="var(--color-border)"
            strokeWidth="1"
            opacity="0.6"
          />
        </g>
      ))}
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
