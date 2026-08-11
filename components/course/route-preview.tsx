"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import {
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  APIProvider,
  ColorScheme,
  Map,
  Polyline,
} from "@vis.gl/react-google-maps";

import { MAPS_BROWSER_KEY, mapId } from "@/lib/maps";
import { previewFrame, type PreviewStop } from "@/lib/route-preview";
import { cn } from "@/lib/utils";

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
 *   card. Numbered rings and the walking line, and nothing else.
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
  onOpen,
  className,
}: {
  stops: PreviewStop[];
  /** Tapping the preview opens the real map sheet. Absent and it stays a
   * picture — the preview never pretends to be tappable when it is not. */
  onOpen?: () => void;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();
  const [mapsFailed, setMapsFailed] = useState(false);
  const frame = previewFrame(stops);

  // Fewer than two positioned holes is not a route; no key is not a map.
  if (!frame || !MAPS_BROWSER_KEY || mapsFailed) return null;

  const dark = resolvedTheme === "dark";
  const path = frame.holes.map((hole) => ({ lat: hole.lat, lng: hole.lng }));

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
          {frame.holes.map((hole) => (
            <AdvancedMarker
              key={`hole-${hole.hole}`}
              position={{ lat: hole.lat, lng: hole.lng }}
              anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
              title={`Hole ${hole.hole}`}
            >
              <div
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border-2 border-background font-serif text-[11px] font-bold text-background shadow-md",
                  // The last hole wears marker gold, the way the card's own
                  // furniture already marks where a round finishes.
                  hole.hole === frame.lastHole ? "bg-marker" : "bg-fairway",
                )}
              >
                {hole.hole}
              </div>
            </AdvancedMarker>
          ))}
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
