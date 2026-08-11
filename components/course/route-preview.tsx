"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import {
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  APIProvider,
  ColorScheme,
  Map,
  Polyline,
  useMap,
} from "@vis.gl/react-google-maps";

import { useDrawIn } from "@/hooks/use-draw-in";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { MAPS_BROWSER_KEY, mapId } from "@/lib/maps";
import {
  patchFrame,
  previewFrame,
  walkRoute,
  type PreviewFrame,
  type PreviewStop,
} from "@/lib/route-preview";
import { cn } from "@/lib/utils";

/**
 * How long the walk takes to draw: a beat per hole, floored and capped.
 *
 * Fixed would be wrong at both ends — six holes would crawl and eighteen would
 * flicker past. The cap matters more than the floor: nobody is watching a map
 * for four seconds, however many pubs are on it.
 */
const DRAW_MS_PER_HOLE = 190;
const DRAW_MS_MIN = 1_200;
const DRAW_MS_MAX = 3_000;

function drawMs(holes: number): number {
  return Math.min(DRAW_MS_MAX, Math.max(DRAW_MS_MIN, holes * DRAW_MS_PER_HOLE));
}

/**
 * The patch, while the caddy is still working it.
 *
 * `pins` is every pub it may choose from; `picked` is the ones it has named so
 * far, in its own order rather than the walking order — that is not decided
 * until the answer is complete, which is exactly why these arrive as pins and
 * the numbers arrive with the card.
 */
export interface LivePatch {
  pins: { id: string; lat: number; lng: number }[];
  picked: string[];
}

/**
 * The walk, on a real map, at the top of the drafting table.
 *
 * A card is a list, and a list cannot answer the question every round of
 * feedback has really been asking: is this a walk or a scatter? `PubMapSheet`
 * answers it and is a tap and a sheet away, so the same map sits above the card
 * — always visible, changing as you edit, and framed on the route itself.
 *
 * Three things make it a *preview* rather than a second map sheet:
 *
 *   **Only the holes.** The sheet also plots search results as pint pins,
 *   because that is where you pick pubs. Here there is nothing to pick, so a
 *   candidate pin would be noise on a map whose whole job is the shape of the
 *   card. Numbered rings and the walking line, and nothing else — with one
 *   exception, `live`, which is the minutes while the caddy is still choosing
 *   and there is no card to show yet.
 *
 *   **Static.** No dragging, no zooming, no controls, no keyboard focus. It is
 *   a picture of the route, and a map that moves under a thumb scrolling past
 *   it is worse than one that does not move at all. The sheet is still where
 *   you go to actually handle the map.
 *
 *   **Framed by the route.** Bounds come from the holes, and the height comes
 *   from the shape of them, so a crawl up one street gets a wide short frame
 *   and a wander round a quarter gets a squarer one.
 *
 * Without a browser key there is no map and no apology — the same absence the
 * builder already keeps when the maps key is missing.
 */
export function RoutePreview({
  stops,
  live,
  onOpen,
  drawKey = 0,
  className,
}: {
  stops: PreviewStop[];
  /** Present while a plan is being made. The map frames the patch and lights
   * pubs up as they are chosen; when the card lands this goes and the walk
   * draws over the same ground without the map moving. */
  live?: LivePatch | null;
  /** Tapping the preview opens the real map sheet. Absent and it stays a
   * picture — the preview never pretends to be tappable when it is not. */
  onOpen?: () => void;
  /**
   * Bump this and the walk draws itself in again.
   *
   * Which edits are worth replaying the animation for is a question only the
   * drafting table can answer, so it answers it: a card off the caddy is a new
   * route and redraws, moving a pub by hand is not and does not. Zero means
   * "nothing has been handed over" — a course loaded from the database is
   * simply there, and animating it on every page load would be scenery.
   */
  drawKey?: number;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();
  const [mapsFailed, setMapsFailed] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const route = previewFrame(stops);
  // The card wins the moment there is one: a route is what the host came for,
  // and the patch behind it has done its job.
  const patch = route ? null : (live?.pins.length ? patchFrame(live.pins) : null);
  const frame = route ?? patch;

  // Nothing to frame is not a map, and neither is no key.
  if (!frame || !MAPS_BROWSER_KEY || mapsFailed) return null;

  const dark = resolvedTheme === "dark";

  return (
    <figure
      className={cn("engraved relative overflow-hidden rounded-xl", className)}
      style={{ aspectRatio: `${frame.aspect}` }}
      data-testid="route-preview"
    >
      <APIProvider apiKey={MAPS_BROWSER_KEY} onError={() => setMapsFailed(true)}>
        <Map
          className="size-full"
          mapId={mapId()}
          // One cloud-authored map ID carries both grounds; colorScheme picks
          // the variant, exactly as the sheet does.
          colorScheme={dark ? ColorScheme.DARK : ColorScheme.LIGHT}
          defaultBounds={{ ...frame.bounds, padding: 48 }}
          // Every way in, closed. A preview that pans when you meant to scroll
          // the page is a trap on a phone.
          gestureHandling="none"
          disableDefaultUI
          keyboardShortcuts={false}
          clickableIcons={false}
        >
          <Reframe bounds={frame.bounds} />
          {route ? (
            /* Remounted whenever the caddy hands over a card, which is what
               replays the walk. The map itself stays put — remounting *that*
               would reload the tiles and flash. */
            <WalkedLine
              key={drawKey}
              frame={route}
              dark={dark}
              animate={drawKey > 0 && !reducedMotion}
            />
          ) : (
            <PatchPins live={live!} picked={new Set(live!.picked)} />
          )}
        </Map>
      </APIProvider>
      {/* The way in. A real button over an inert map, rather than handlers on
          the map itself: the map is deliberately deaf to gestures, so the thing
          you tap has to sit above it — and being a button is what makes it
          reachable by keyboard and readable to a screen reader, which a
          clickable div would not be. */}
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="absolute inset-0 flex items-end justify-end p-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="rounded-full border border-border bg-card/90 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
            Open the map
          </span>
        </button>
      ) : null}
    </figure>
  );
}

/**
 * The walking line and its numbered pins — drawn all at once, or walked.
 *
 * Separate from the map on purpose. This is the part that has animation state,
 * and it is remounted (by `key`) every time there is a new card to draw, which
 * resets that state without touching the map above it.
 */
function WalkedLine({
  frame,
  dark,
  animate,
}: {
  frame: PreviewFrame;
  dark: boolean;
  animate: boolean;
}) {
  const progress = useDrawIn(animate, drawMs(frame.holes.length));
  const { path, reached } = walkRoute(frame.holes, progress);

  return (
    <>
      <Polyline
        path={path}
        strokeOpacity={0}
        icons={[
          {
            // The same dotted walking line the sheet draws, so the two
            // read as one map seen at two sizes.
            icon: {
              path: "M0,0m-1,0a1,1 0 1,0 2,0a1,1 0 1,0 -2,0",
              fillColor: dark ? "#e9e2d0" : "#1e4630",
              fillOpacity: 1,
              strokeOpacity: 0,
              scale: 2,
            },
            offset: "0",
            repeat: "12px",
          },
        ]}
      />
      {/* Only the pubs the walk has actually reached. Each one mounts as the
          line arrives, so the entrance below plays per pin rather than nine at
          once — which is what turns a route into a crawl. */}
      {frame.holes.slice(0, reached).map((hole) => (
        <AdvancedMarker
          key={`hole-${hole.hole}`}
          position={{ lat: hole.lat, lng: hole.lng }}
          anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
          title={`Hole ${hole.hole}`}
        >
          <div
            className={cn(
              "flex size-6 items-center justify-center rounded-full border-2 border-background font-serif text-[11px] font-bold text-background shadow-md",
              "animate-in zoom-in-50 fade-in duration-300",
              // The last hole wears marker gold, the way the card's own
              // furniture already marks where a round finishes.
              hole.hole === frame.lastHole ? "bg-marker" : "bg-fairway",
            )}
          >
            {hole.hole}
          </div>
        </AdvancedMarker>
      ))}
    </>
  );
}

/**
 * The patch, mid-decision: every candidate faint, the chosen ones lit.
 *
 * No numbers and no line, because neither exists yet — the caddy has named
 * pubs and the club has not routed them. Showing a walk here would be showing
 * a decision that has not been taken.
 */
function PatchPins({ live, picked }: { live: LivePatch; picked: Set<string> }) {
  return (
    <>
      {live.pins.map((pin) => {
        const chosen = picked.has(pin.id);
        return (
          <AdvancedMarker
            key={pin.id}
            position={{ lat: pin.lat, lng: pin.lng }}
            anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
          >
            <div
              className={cn(
                "rounded-full transition-all duration-500",
                chosen
                  ? "size-3.5 bg-fairway ring-2 ring-background"
                  : "size-1.5 bg-muted-foreground/40",
              )}
            />
          </AdvancedMarker>
        );
      })}
    </>
  );
}

/**
 * Keep the map on the frame, not on the first frame it ever saw.
 *
 * `defaultBounds` is initial-only — every `default*` prop in
 * @vis.gl/react-google-maps sets the view on mount and is never read again. So
 * a host who planned Shoreditch and then changed the patch to Camden kept
 * looking at Shoreditch: the pins moved, the map did not. It looked correct on
 * a fresh load for the worst possible reason, which is that a fresh load *is* a
 * mount.
 *
 * Re-framing imperatively rather than remounting the `<Map>`: a remount
 * reloads the tiles, flashes, and bills another map load. This is the same
 * thing `pub-map-sheet.tsx` already does with its viewport.
 */
function Reframe({ bounds }: { bounds: PreviewFrame["bounds"] }) {
  const map = useMap();
  // Depending on the four numbers rather than the object: `frame` is rebuilt on
  // every render, so an object identity here would re-fit the map continuously.
  const { north, south, east, west } = bounds;
  useEffect(() => {
    if (!map) return;
    map.fitBounds({ north, south, east, west }, 48);
  }, [map, north, south, east, west]);
  return null;
}
