"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "next-themes";
import { ExternalLink, Star, X } from "lucide-react";
import {
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  APIProvider,
  ColorScheme,
  Map,
  Polyline,
  useMap,
} from "@vis.gl/react-google-maps";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { MAPS_BROWSER_KEY, mapId } from "@/lib/maps";
import {
  rerouteMenu,
  type CaddyMenu,
  type MenuNode,
  type MenuRoute,
} from "@/lib/caddy/menu";
import {
  HOLE_CHOICES,
  STRETCH_CHOICES,
} from "@/lib/caddy/brief";
import { WALK_MINUTES_PER_KM } from "@/lib/geo";
import type { PlannedCourse } from "@/lib/caddy/plan";
import { cn } from "@/lib/utils";

/**
 * The gallery: golf's word for the crowd that follows a shot, and what the
 * plan's twenty seconds become.
 *
 * Tapping *Plan the round* opens this over everything — the patch on a live
 * map, the route menu as the middle act, and the dressing narrated on a
 * ticker — then hands back to the drafting table when the card lands.
 *
 * Three rules keep it honest:
 *
 *   **Leaving never cancels.** The X hides the overlay and nothing else. The
 *   plan's stream belongs to the group behind this, the card is written
 *   before it is streamed, and `collectCaddyCard` already rescues a broken
 *   connection — the gallery is optional viewing of work that does not need
 *   watching.
 *
 *   **The menu is arithmetic.** Flipping walks and re-dialling spacing or
 *   holes re-runs the pure router over the lean nodes, in the browser, for
 *   nothing. Only *Dress this walk* spends.
 *
 *   **No key, no gallery.** Without a browser maps key the plan runs exactly
 *   as it always did on the inline panel — the same graceful absence the
 *   builder keeps everywhere else.
 */

export type GalleryStage = "opening" | "menu" | "dressing" | "done" | "failed";

export interface GalleryState {
  stage: GalleryStage;
  menu: CaddyMenu | null;
  /** Pubs the caddy has named so far, in its own order, while dressing. */
  picked: string[];
  doing: string;
  thinking: string;
  course: PlannedCourse | null;
  error: string | null;
}

/** The dials as the gallery hands them back: what to dress, and at what
 * shape. Null route means the caddy chooses. */
export interface DressChoice {
  route: string[] | null;
  holes: number;
  stretch: number;
}

/**
 * A pub the host tapped, whichever stage they tapped it in.
 *
 * The menu's lean node and the finished card's hole carry different halves
 * of the same pub, so both are normalised to this before anything renders —
 * one card, not two nearly-identical ones. Everything here is what Google's
 * *free* search already shows anyone; the dossier's atmosphere half never
 * leaves the server, so nothing about this costs a second call.
 */
interface TappedPub {
  name: string;
  address: string | null;
  rating: number | null;
  reviewCount: number | null;
  lat: number;
  lng: number;
  /** Set only once the card exists — its dressing, in the house's words. */
  hole?: { number: number; drink: string; par: number; hazard: string | null };
}

/** Google's own page for the place. A link out rather than a fetch: their
 * terms want Places results on a Google surface, and it is the one place
 * that always has the hours, the photos and the reviews in full. */
function googleMapsHref(pub: TappedPub): string {
  const query = encodeURIComponent(`${pub.name} ${pub.lat},${pub.lng}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

const STAGE_LINES: Record<GalleryStage, string> = {
  opening: "The caddy’s walking the patch",
  menu: "Pick the walk — or let the caddy",
  dressing: "The caddy’s dressing the card",
  done: "On the table",
  failed: "The caddy lost the ball",
};

const noSubscription = () => () => {};

/** What the pill says for each stage it can be minimised in. */
const PILL_LINES: Partial<Record<GalleryStage, string>> = {
  opening: "The caddy’s walking the patch",
  menu: "Walks ready — come pick one",
  dressing: "The caddy’s dressing the card",
  failed: "The caddy lost the ball — take a look",
};

export function CaddyGallery({
  open,
  active,
  nonce,
  state,
  holes,
  stretch,
  onDress,
  onClose,
  onReopen,
}: {
  open: boolean;
  /** A plan is in flight (or failed unseen). This is what makes the job
   * visible from every screen: closed-but-active renders the pill, because
   * a running plan is visible everywhere or it is lost from everywhere. */
  active: boolean;
  /** Bumped per plan. The body remounts on it, which is what re-seeds the
   * dials and the selection without a single state-syncing effect. */
  nonce: number;
  state: GalleryState;
  /** The brief's dials, seeding the menu's own. */
  holes: number;
  stretch: number;
  onDress: (choice: DressChoice) => void;
  onClose: () => void;
  onReopen: () => void;
}) {
  // Mounted portals only: the overlay renders into <body>, so no ancestor
  // transform can trap the fixed positioning. `useSyncExternalStore` is the
  // house's hydration guard — never a mounted-flag effect.
  const body = useSyncExternalStore(
    noSubscription,
    () => document.body,
    () => null,
  );
  if (!body || !MAPS_BROWSER_KEY) return null;

  // Minimised: the job wears the pill. Same component, second window — the
  // Uber posture: closing the view never hides the work.
  if (!open) {
    const line = active ? PILL_LINES[state.stage] : undefined;
    if (!line) return null;
    return createPortal(
      <button
        type="button"
        onClick={onReopen}
        data-testid="caddy-pill"
        aria-label={`${line} — reopen the caddy's plan`}
        className="fixed bottom-20 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 items-center gap-2.5 rounded-full border border-fairway bg-card px-4 py-2.5 text-left shadow-lg"
      >
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full motion-reduce:animate-none",
            state.stage === "failed" ? "bg-hazard" : "animate-pulse bg-marker",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-bold">
            {state.stage === "dressing" && state.doing ? state.doing : line}
          </span>
          <span className="block text-[10px] font-semibold text-muted-foreground">
            tap to watch
          </span>
        </span>
        <span className="shrink-0 text-[11px] font-bold text-fairway">Watch</span>
      </button>,
      body,
    );
  }

  return createPortal(
    <GalleryBody
      key={nonce}
      state={state}
      holes={holes}
      stretch={stretch}
      onDress={onDress}
      onClose={onClose}
    />,
    body,
  );
}

function GalleryBody({
  state,
  holes,
  stretch,
  onDress,
  onClose,
}: {
  state: GalleryState;
  holes: number;
  stretch: number;
  onDress: (choice: DressChoice) => void;
  onClose: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const reducedMotion = usePrefersReducedMotion();
  const [mapsFailed, setMapsFailed] = useState(false);

  // The menu's own dials, seeded from the brief. Initial-value only, on
  // purpose: a fresh plan remounts this body (the `key` above), which is
  // what re-seeds them.
  const [dialHoles, setDialHoles] = useState(holes);
  const [dialStretch, setDialStretch] = useState(stretch);
  const [routeIndex, setRouteIndex] = useState(0);
  /** The pub the host tapped, if any. Null is the ordinary state. */
  const [tapped, setTapped] = useState<TappedPub | null>(null);

  /**
   * The walks on offer: the server's menu as dealt, re-routed in the browser
   * the moment a dial moves. Pure arithmetic over the lean nodes — the whole
   * reason iterating here is free.
   */
  const routes: MenuRoute[] = useMemo(() => {
    if (!state.menu) return [];
    if (dialHoles === holes && dialStretch === stretch) return state.menu.routes;
    return rerouteMenu(state.menu, { holes: dialHoles, stretch: dialStretch });
  }, [state.menu, dialHoles, dialStretch, holes, stretch]);
  const route = routes[Math.min(routeIndex, Math.max(routes.length - 1, 0))] ?? null;

  // The widening: the overlay grows from the middle of the screen unless
  // motion is reduced, in which case it is simply there.
  const grow = reducedMotion ? "" : "animate-in fade-in zoom-in-95 duration-300";

  if (mapsFailed) return null;

  const dark = resolvedTheme === "dark";
  // A record rather than a `Map`: the component import shadows the global
  // constructor in this file, exactly as route-preview.tsx already notes.
  const byId: Record<string, MenuNode> = {};
  for (const node of state.menu?.nodes ?? []) byId[node.id] = node;

  // What the map draws depends on the act. While dressing, the caddy's own
  // picks; at the menu, the selected walk; when done, the finished card.
  const walkIds =
    state.stage === "dressing"
      ? state.picked.filter((id) => byId[id] != null)
      : state.stage === "menu" && route
        ? route.stops
        : [];
  const walkPath = walkIds.flatMap((id) => {
    const node = byId[id];
    return node ? [{ lat: node.lat, lng: node.lng }] : [];
  });
  const donePath =
    state.stage === "done" && state.course
      ? state.course.holes.flatMap((hole) =>
          hole.lat != null && hole.lng != null
            ? [{ lat: hole.lat, lng: hole.lng }]
            : [],
        )
      : [];

  const stats =
    route && state.stage === "menu"
      ? [
          `${route.totalKm.toFixed(1)} km`,
          `longest leg ${Math.max(1, Math.round(route.worstLegKm * WALK_MINUTES_PER_KM))} min`,
          `${route.stops.length} pubs`,
          `${route.variety} kinds`,
        ].join(" · ")
      : null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex flex-col bg-background",
        grow,
      )}
      role="dialog"
      aria-label="The gallery — the caddy planning your round"
      data-testid="caddy-gallery"
    >
      {/* The map is the screen. Everything else floats over it. */}
      <div className="relative flex-1">
        <APIProvider apiKey={MAPS_BROWSER_KEY} onError={() => setMapsFailed(true)}>
          <Map
            className="size-full"
            mapId={mapId()}
            colorScheme={dark ? ColorScheme.DARK : ColorScheme.LIGHT}
            defaultCenter={{ lat: 51.5, lng: -0.08 }}
            defaultZoom={13}
            gestureHandling="greedy"
            disableDefaultUI
            keyboardShortcuts={false}
            clickableIcons={false}
          >
            <FrameNodes nodes={state.menu?.nodes ?? []} course={state.course} />
            {/* Every candidate, faint; the walk's stops light up over them. */}
            {(state.menu?.nodes ?? []).map((node) => (
              <AdvancedMarker
                key={node.id}
                position={{ lat: node.lat, lng: node.lng }}
                anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
                title={node.name}
                onClick={() =>
                  setTapped({
                    name: node.name,
                    address: node.address,
                    rating: node.rating,
                    reviewCount: node.reviewCount,
                    lat: node.lat,
                    lng: node.lng,
                  })
                }
              >
                <div
                  className={cn(
                    "rounded-full transition-all duration-300",
                    walkIds.includes(node.id)
                      ? "size-3.5 bg-fairway ring-2 ring-background"
                      : "size-1.5 bg-muted-foreground/40",
                  )}
                />
              </AdvancedMarker>
            ))}
            {/* The walk under consideration — dotted, the house's own line. */}
            {walkPath.length > 1 ? <DottedWalk path={walkPath} dark={dark} /> : null}
            {state.stage === "menu" && route
              ? route.stops.map((id, index) => {
                  const node = byId[id];
                  if (!node) return null;
                  return (
                    <AdvancedMarker
                      key={`stop-${id}`}
                      position={{ lat: node.lat, lng: node.lng }}
                      anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
                      title={`Hole ${index + 1} — ${node.name}`}
                      onClick={() =>
                        setTapped({
                          name: node.name,
                          address: node.address,
                          rating: node.rating,
                          reviewCount: node.reviewCount,
                          lat: node.lat,
                          lng: node.lng,
                        })
                      }
                    >
                      <div
                        className={cn(
                          "flex size-6 items-center justify-center rounded-full border-2 border-background font-serif text-[11px] font-bold text-background shadow-md",
                          index === route.stops.length - 1 ? "bg-marker" : "bg-fairway",
                        )}
                      >
                        {index + 1}
                      </div>
                    </AdvancedMarker>
                  );
                })
              : null}
            {/* The finished card, numbered in walking order. */}
            {state.stage === "done" && state.course
              ? state.course.holes.map((hole, index) =>
                  hole.lat != null && hole.lng != null ? (
                    <AdvancedMarker
                      key={`done-${index}`}
                      position={{ lat: hole.lat, lng: hole.lng }}
                      anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
                      title={`Hole ${index + 1} — ${hole.venue_name}`}
                      onClick={() =>
                        setTapped({
                          name: hole.venue_name,
                          address: hole.address,
                          rating: hole.rating,
                          reviewCount: null,
                          lat: hole.lat as number,
                          lng: hole.lng as number,
                          hole: {
                            number: index + 1,
                            drink: hole.drink,
                            par: hole.par,
                            hazard: hole.hazard,
                          },
                        })
                      }
                    >
                      <div
                        className={cn(
                          "flex size-6 items-center justify-center rounded-full border-2 border-background font-serif text-[11px] font-bold text-background shadow-md",
                          index === state.course!.holes.length - 1
                            ? "bg-marker"
                            : "bg-fairway",
                        )}
                      >
                        {index + 1}
                      </div>
                    </AdvancedMarker>
                  ) : null,
                )
              : null}
            {donePath.length > 1 ? <DottedWalk path={donePath} dark={dark} /> : null}
          </Map>
        </APIProvider>

        {/* The stage, named. */}
        <span className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-card/95 px-3 py-1 text-[11px] font-semibold shadow-sm">
          {state.stage === "done" && state.course
            ? `On the table — ${state.course.name}`
            : STAGE_LINES[state.stage]}
        </span>

        {/* The pub the host tapped. Over the map rather than in a sheet: a
            dialog inside a fullscreen dialog is a stack nobody asked for,
            and the point of tapping a pin is to look at it *next to* the
            walk it sits on. Everything shown is what the free search
            already returns; Google's own page is one tap further for the
            hours, the photos and the reviews in full. */}
        {tapped ? (
          <div
            className="animate-in fade-in slide-in-from-bottom-2 absolute inset-x-3 bottom-3 z-30 rounded-xl border border-border bg-card p-3 shadow-lg"
            data-testid="pub-card"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                {tapped.hole ? (
                  <span className="eyebrow text-fairway">
                    Hole {tapped.hole.number}
                    {tapped.hole.hazard ? ` · ${tapped.hole.hazard}` : ""}
                  </span>
                ) : null}
                <p className="truncate font-serif text-base leading-tight">
                  {tapped.name}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {tapped.rating != null ? (
                    <>
                      <Star
                        className="size-3 fill-marker text-marker"
                        aria-hidden
                      />
                      <span className="tabular">{tapped.rating.toFixed(1)}</span>
                      {tapped.reviewCount ? (
                        <span className="tabular">
                          ({tapped.reviewCount.toLocaleString()})
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span>No rating yet</span>
                  )}
                </p>
                {tapped.address ? (
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {tapped.address}
                  </p>
                ) : null}
                {tapped.hole ? (
                  <p className="mt-1 text-[11.5px]">
                    {tapped.hole.drink} · par {tapped.hole.par}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setTapped(null)}
                aria-label="Close"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <a
              href={googleMapsHref(tapped)}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-border text-[11px] font-bold text-fairway"
            >
              Hours, photos and reviews on Google
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
        ) : null}

        {/* The way out. Leaving never cancels: the plan carries on and the
            card lands on the drafting table exactly as it always has. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Leave the gallery — the plan carries on"
          className="absolute top-2 right-2 flex size-11 items-center justify-center rounded-full border border-border bg-card/95 text-muted-foreground shadow-sm hover:text-foreground"
          data-testid="gallery-close"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {/* Below the map: the act's own furniture, in the app's column. */}
      <div className="mx-auto w-full max-w-md px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">
        {state.stage === "menu" && state.menu ? (
          <div className="flex flex-col gap-2.5">
            <div
              className="flex flex-wrap gap-1.5"
              role="radiogroup"
              aria-label="The walks on offer"
            >
              {routes.map((entry, index) => (
                <Chip
                  key={`${entry.character}-${index}`}
                  role="radio"
                  aria-checked={index === routeIndex}
                  active={index === routeIndex}
                  onClick={() => setRouteIndex(index)}
                >
                  {entry.character}
                </Chip>
              ))}
            </div>
            {stats ? (
              <p className="text-center text-[11px] text-muted-foreground tabular">{stats}</p>
            ) : null}
            {/* The patch's shape, where it is remarkable: two pockets with a
                march between them, or one street. A note on every patch
                would be a note nobody reads. */}
            {state.menu.note ? (
              <p className="text-center font-serif text-[11px] italic text-muted-foreground">
                {state.menu.note}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Holes">
              {HOLE_CHOICES.map((count) => (
                <Chip
                  key={count}
                  active={dialHoles === count}
                  onClick={() => {
                    setDialHoles(count);
                    setRouteIndex(0);
                  }}
                >
                  {count}
                </Chip>
              ))}
              <span className="mx-1 text-[10px] text-muted-foreground">·</span>
              {STRETCH_CHOICES.map((entry) => (
                <Chip
                  key={entry.id}
                  active={dialStretch === entry.id}
                  onClick={() => {
                    setDialStretch(entry.id);
                    setRouteIndex(0);
                  }}
                >
                  {entry.label}
                </Chip>
              ))}
            </div>
            <p className="text-center text-[10px] text-muted-foreground">
              Every tap re-routes on the spot — choosing is free.
            </p>
            <Button
              className="w-full"
              onClick={() =>
                onDress({
                  route: route?.stops ?? null,
                  holes: dialHoles,
                  stretch: dialStretch,
                })
              }
              data-testid="dress-this-walk"
            >
              Dress this walk
            </Button>
            <Button
              variant="outline"
              size="compact"
              className="h-11 w-full"
              onClick={() =>
                onDress({ route: null, holes: dialHoles, stretch: dialStretch })
              }
            >
              Caddy&rsquo;s choice
            </Button>
          </div>
        ) : null}

        {state.stage === "opening" || state.stage === "dressing" ? (
          <div className="flex min-h-16 flex-col items-center gap-1 rounded-xl border border-border bg-card px-4 py-3">
            {state.doing ? (
              <p className="animate-in fade-in line-clamp-1 max-w-full text-center text-[11px] font-semibold text-fairway">
                {state.doing}
              </p>
            ) : (
              <p className="text-[11px] font-semibold text-fairway">
                {state.stage === "opening" ? "Walking the patch" : "Dressing the card"}
              </p>
            )}
            {state.thinking ? (
              <p
                aria-live="off"
                className="animate-in fade-in line-clamp-2 max-w-full text-center text-[11px] text-muted-foreground/80 italic"
              >
                {state.thinking}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {state.stage === "opening" ? "About ten seconds." : "Won’t be long."}
              </p>
            )}
          </div>
        ) : null}

        {state.stage === "done" ? (
          <div className="flex flex-col gap-2">
            {/* Street truth, where the streets answered for every leg. */}
            {state.course?.legMinutes?.length &&
            state.course.legMinutes.every((leg) => leg !== null) ? (
              <p className="text-center text-[11px] text-muted-foreground tabular">
                Walks checked against the streets —{" "}
                {state.course.legMinutes.reduce((sum, leg) => sum + (leg ?? 0), 0)}{" "}
                min all told.
              </p>
            ) : null}
            <Button className="w-full" onClick={onClose} data-testid="gallery-done">
              Back to the table
            </Button>
          </div>
        ) : null}

        {state.stage === "failed" ? (
          <div className="flex flex-col gap-2">
            <p className="text-center text-xs text-hazard">
              {state.error ?? "The caddy lost the ball. Ask again — this one's free."}
            </p>
            <Button variant="outline" size="compact" className="h-11 w-full" onClick={onClose}>
              Back to the table
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The dotted walking line, exactly as the preview draws it. */
function DottedWalk({
  path,
  dark,
}: {
  path: { lat: number; lng: number }[];
  dark: boolean;
}) {
  return (
    <Polyline
      path={path}
      strokeOpacity={0}
      icons={[
        {
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
  );
}

/** Keep the map on the patch — or on the finished card once there is one. */
function FrameNodes({
  nodes,
  course,
}: {
  nodes: { lat: number; lng: number }[];
  course: PlannedCourse | null;
}) {
  const map = useMap();
  const points = course
    ? course.holes.flatMap((hole) =>
        hole.lat != null && hole.lng != null
          ? [{ lat: hole.lat, lng: hole.lng }]
          : [],
      )
    : nodes;
  const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|");
  useEffect(() => {
    if (!map || points.length === 0) return;
    const bounds = points.reduce(
      (acc, p) => ({
        north: Math.max(acc.north, p.lat),
        south: Math.min(acc.south, p.lat),
        east: Math.max(acc.east, p.lng),
        west: Math.min(acc.west, p.lng),
      }),
      { north: -90, south: 90, east: -180, west: 180 },
    );
    map.fitBounds(bounds, 64);
    // Depending on the serialised points rather than the array identity —
    // the array is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}
