"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "next-themes";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ExternalLink,
  RotateCcw,
  Star,
  X,
} from "lucide-react";
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
import { RetractingPanel } from "@/components/course/retracting-panel";
import { StageRail } from "@/components/course/stage-rail";
import {
  JOB_HEADLINE,
  JOB_PILL,
  jobPanelLabel,
  jobWorking,
  type JobStage,
  type PlanProgress,
  type PlanStage,
} from "@/lib/caddy/stages";
import { swapOptions, walkStats } from "@/lib/caddy/swap";
import { useMenuDials, type MenuDials } from "@/hooks/use-menu-dials";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { MAPS_BROWSER_KEY, mapId } from "@/lib/maps";
import type { CaddyMenu, MenuNode } from "@/lib/caddy/menu";
import { HOLE_CHOICES, STRETCH_CHOICES } from "@/lib/caddy/brief";
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

/** The gallery's own name for `JobStage`. An alias rather than a copy: the
 * two lists drifting is how "in flight" and "has something to say" came to be
 * confused in the first place. */
export type GalleryStage = JobStage;

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
  /** Where this pub stands in the walk being chosen, when it stands in one.
   * Null for a candidate pin nobody has picked and for the finished card,
   * which is the drafting table's to edit rather than the menu's. */
  stopIndex?: number | null;
}

/** Google's own page for the place. A link out rather than a fetch: their
 * terms want Places results on a Google surface, and it is the one place
 * that always has the hours, the photos and the reviews in full. */
function googleMapsHref(pub: TappedPub): string {
  const query = encodeURIComponent(`${pub.name} ${pub.lat},${pub.lng}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

const noSubscription = () => () => {};

/** The swap row's buttons: small, but still a 36px target apiece. */
const swapButton =
  "flex min-h-9 items-center justify-center gap-1 rounded-lg border border-border px-2.5 text-[11px] font-bold hover:bg-secondary disabled:opacity-30";

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
  onStep,
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
  /** Step back an act. Absent on surfaces with no stage rail behind them, in
   * which case the gallery's own rail is a display. */
  onStep?: (stage: PlanStage) => void;
}) {
  // Above every early return, and above the overlay's own mount: a walk the
  // host has edited must survive closing the gallery to glance at the map.
  const dials = useMenuDials(state.menu);
  /**
   * Which plan the dials are currently seeded for.
   *
   * React's own "adjusting state when a prop changes" pattern: state compared
   * during render, re-rendering immediately without committing. Not an effect
   * (the house forbids setState in one) and not a `key` on the body (that ties
   * re-seeding to a component which unmounts for other reasons entirely, which
   * is exactly what was deleting hand-edited walks).
   */
  const [seeded, setSeeded] = useState(-1);
  if (state.menu && seeded !== nonce) {
    setSeeded(nonce);
    dials.seed({ holes, stretch });
  }

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
    const line = active ? JOB_PILL[state.stage] : null;
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
        <span className="shrink-0 text-[11px] font-bold text-fairway">
          Watch
        </span>
      </button>,
      body,
    );
  }

  return createPortal(
    <GalleryBody
      state={state}
      dials={dials}
      onDress={onDress}
      onClose={onClose}
      onStep={onStep}
    />,
    body,
  );
}

function GalleryBody({
  state,
  dials,
  onDress,
  onClose,
  onStep,
}: {
  state: GalleryState;
  dials: MenuDials;
  onDress: (choice: DressChoice) => void;
  onClose: () => void;
  onStep?: (stage: PlanStage) => void;
}) {
  const { resolvedTheme } = useTheme();
  const reducedMotion = usePrefersReducedMotion();
  const [mapsFailed, setMapsFailed] = useState(false);

  /**
   * Whether the furniture is up. Up to begin with — the panel is where the
   * whole act happens — and a host who pushes it down to watch the map keeps
   * it down as the stages pass, because the tab tells them what is under it.
   * Springing back open at every stage change would be arguing with them.
   */
  const [panelOpen, setPanelOpen] = useState(true);

  const { routes, route, stops, edited, swapping } = dials;
  /**
   * A pub tapped that is *not* a stop on the walk — a faint candidate pin, or
   * a hole on the finished card. Held as a snapshot because there is no
   * position to derive it from.
   */
  const [pinned, setPinned] = useState<TappedPub | null>(null);

  // The widening: the overlay grows from the middle of the screen unless
  // motion is reduced, in which case it is simply there.
  const grow = reducedMotion
    ? ""
    : "animate-in fade-in zoom-in-95 duration-300";

  const dark = resolvedTheme === "dark";
  // A record rather than a `Map`: the component import shadows the global
  // constructor in this file, exactly as route-preview.tsx already notes.
  const byId: Record<string, MenuNode> = {};
  for (const node of state.menu?.nodes ?? []) byId[node.id] = node;

  /**
   * The card over the map.
   *
   * **Derived from the position, never stored.** It used to be a snapshot
   * taken at tap time, and every control that re-routed left it pointing at a
   * walk that no longer existed: on a shorter walk the card described the
   * wrong pub, "Swap" answered "nothing else round here" over a full menu, and
   * "Later" moved a stop the host had never tapped. A position into the walk
   * on screen cannot go stale, because there is only one walk.
   */
  const stopCard: TappedPub | null =
    state.stage === "menu" && dials.tapped != null && stops[dials.tapped]
      ? (() => {
          const node = byId[stops[dials.tapped]];
          if (!node) return null;
          return {
            stopIndex: dials.tapped,
            name: node.name,
            address: node.address,
            rating: node.rating,
            reviewCount: node.reviewCount,
            lat: node.lat,
            lng: node.lng,
          };
        })()
      : null;
  const tapped = stopCard ?? pinned;

  function closeCard() {
    setPinned(null);
    dials.setTapped(null);
    dials.setSwapping(false);
  }

  // What the map draws depends on the act. While dressing, the caddy's own
  // picks; at the menu, the selected walk; when done, the finished card.
  const walkIds =
    state.stage === "dressing"
      ? state.picked.filter((id) => byId[id] != null)
      : state.stage === "menu" && route
        ? stops
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

  /**
   * Where the host is, in the room's own vocabulary. By the time the gallery
   * is up the first three acts are behind them by definition — there is no
   * gallery without an aim — so the only live question is whether the caddy
   * is mid-request, which is what closes the road back.
   */
  const galleryProgress: PlanProgress = {
    locked: true,
    aimed: true,
    planning: jobWorking(state.stage),
    carded: state.stage === "done",
  };

  // Down, the tab is the whole panel, so it says what the panel is holding —
  // and at the menu it names the walk on the map, which is the one fact worth
  // a row when the controls that chose it are hidden.
  const panelLabel = jobPanelLabel(state.stage, route?.character);

  // Recomputed from the walk on screen rather than read off the route the
  // caddy offered — the moment a stop is swapped those two are different
  // walks, and a stat line describing the wrong one is worse than none.
  const shown = walkStats(stops, state.menu?.nodes ?? []);

  /** What else could stand where the tapped stop stands. Recomputed per
   * render because it is a handful of distances over nodes already in hand —
   * memoising it would cost more than it saves and could go stale on a swap. */
  const alternatives =
    stopCard?.stopIndex != null
      ? swapOptions(stops, stopCard.stopIndex, state.menu?.nodes ?? [])
      : [];

  /**
   * The three edits, each of which leaves the card open on the pub it now
   * concerns rather than closing under the thumb that made the change.
   * Event handlers, not effects — the strict hooks rules stay satisfied and
   * the walk only ever changes because somebody asked it to.
   */
  const stats =
    route && state.stage === "menu"
      ? [
          `${shown.totalKm.toFixed(1)} km`,
          `longest leg ${Math.max(1, Math.round(shown.worstLegKm * WALK_MINUTES_PER_KM))} min`,
          `${stops.length} pubs`,
          // Variety counts kinds of place, which lives on the router's own
          // nodes rather than the lean ones — so it is offered for the walk
          // the router described and withheld for one the host has rewritten.
          ...(edited ? [] : [`${route.variety} kinds`]),
        ].join(" · ")
      : null;

  return (
    <div
      className={cn("fixed inset-0 z-50 flex flex-col bg-background", grow)}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      // Escape leaves, like every other overlay in the house. Leaving never
      // cancels — the plan carries on and the card still lands — so there is
      // nothing here to confirm.
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      aria-label="The gallery — the caddy planning your round"
      data-testid="caddy-gallery"
    >
      {/* Where the plan has got to, for a screen reader. The ticker's own
          reasoning stays `aria-live="off"` — it is a window, not an
          announcement, and reading it aloud would bury the stage. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {JOB_HEADLINE[state.stage]}
        {state.doing ? `. ${state.doing}` : ""}
      </p>

      {/* The map is the screen. Everything else floats over it. `min-h-0` so
          a panel standing at its full height squeezes the map rather than
          pushing the bottom of it off the glass. */}
      <div className="relative min-h-0 flex-1">
        {mapsFailed ? (
          /* The overlay stays. It used to return null the moment Google's
             script failed — taking the narration, the walks, the stats and
             both dress buttons with it, and leaving a paid-for menu
             unreachable behind a blank screen. Only the map is missing. */
          <div className="flex h-full items-center justify-center px-8 text-center text-xs text-muted-foreground">
            The map would not load — the walks still work.
          </div>
        ) : (
          <APIProvider
            apiKey={MAPS_BROWSER_KEY}
            onError={() => setMapsFailed(true)}
          >
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
              <FrameNodes
                nodes={state.menu?.nodes ?? []}
                course={state.course}
              />
              {/* Every candidate, faint; the walk's stops light up over them. */}
              {(state.menu?.nodes ?? []).map((node) => (
                <AdvancedMarker
                  key={node.id}
                  position={{ lat: node.lat, lng: node.lng }}
                  anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
                  title={node.name}
                  onClick={() =>
                    setPinned({
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
              {walkPath.length > 1 ? (
                <DottedWalk path={walkPath} dark={dark} />
              ) : null}
              {state.stage === "menu" && route
                ? stops.map((id, index) => {
                    const node = byId[id];
                    if (!node) return null;
                    return (
                      <AdvancedMarker
                        key={`stop-${id}`}
                        position={{ lat: node.lat, lng: node.lng }}
                        anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
                        title={`Hole ${index + 1} — ${node.name}`}
                        onClick={() => {
                          setPinned(null);
                          dials.setSwapping(false);
                          dials.setTapped(index);
                        }}
                      >
                        <div
                          className={cn(
                            "flex size-6 items-center justify-center rounded-full border-2 border-background font-serif text-[11px] font-bold text-background shadow-md",
                            index === stops.length - 1
                              ? "bg-marker"
                              : "bg-fairway",
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
                          setPinned({
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
              {donePath.length > 1 ? (
                <DottedWalk path={donePath} dark={dark} />
              ) : null}
            </Map>
          </APIProvider>
        )}

        {/* The four acts, carried into the gallery.
            The gallery is a fullscreen portal over the course room, so it
            covered the room's own rail at exactly the moment a host most
            wants it — pressing *Dress this walk* looked like losing the
            progress bar. Same component, same rules, and stepping back closes
            the gallery on the way. */}
        {/*
         * **`pointer-events-none` on the container, `auto` on the chrome.**
         * This box is full-width and painted at z-20; the close button below
         * is `z-auto`. So the container — not the rail, the whole invisible
         * box around it — was swallowing every tap on the X, at every screen
         * size. Leaving is the only exit at three of the five stages, so the
         * documented "leaving never cancels" door was simply dead.
         *
         * `right-14` keeps the centred pill out from under the button as well,
         * so the two never overlap even before hit-testing decides anything,
         * and both clear the notch the room's own header already clears.
         */}
        <div className="pointer-events-none absolute top-[max(env(safe-area-inset-top),8px)] right-14 left-2 z-20 flex flex-col items-center gap-1">
          <div className="pointer-events-auto flex max-w-full items-center rounded-full border border-border bg-card/95 px-1 shadow-sm">
            <StageRail
              progress={galleryProgress}
              onGo={onStep ? (stage) => onStep(stage) : undefined}
            />
          </div>
          <span className="max-w-full truncate rounded-full border border-border bg-card/95 px-3 py-1 text-[11px] font-semibold shadow-sm">
            {state.stage === "done" && state.course
              ? `On the table — ${state.course.name}`
              : JOB_HEADLINE[state.stage]}
          </span>
        </div>

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
                      <span className="tabular">
                        {tapped.rating.toFixed(1)}
                      </span>
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
                onClick={closeCard}
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

            {/* Changing the walk, in the browser, for nothing.
                "Not that pub" is the commonest note a host has and its only
                answers were re-roll the whole card — a paid go — or edit it by
                hand afterwards. This is neither: the nodes are already here,
                so a stop can be exchanged or moved as many times as it takes
                before a credit is spent on dressing the result. */}
            {tapped.stopIndex != null ? (
              <div
                className="mt-2 border-t border-border pt-2"
                data-testid="swap-controls"
              >
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Move this pub earlier in the walk"
                    disabled={tapped.stopIndex === 0}
                    onClick={() => dials.moveStop(tapped.stopIndex!, -1)}
                    className={swapButton}
                  >
                    <ArrowLeft className="size-3" aria-hidden />
                    Earlier
                  </button>
                  <button
                    type="button"
                    aria-label="Move this pub later in the walk"
                    disabled={tapped.stopIndex === stops.length - 1}
                    onClick={() => dials.moveStop(tapped.stopIndex!, 1)}
                    className={swapButton}
                  >
                    Later
                    <ArrowRight className="size-3" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-expanded={swapping}
                    onClick={() => dials.setSwapping(!swapping)}
                    className={cn(swapButton, "flex-1 text-fairway")}
                    data-testid="swap-open"
                  >
                    <ArrowLeftRight className="size-3" aria-hidden />
                    {swapping ? "Keep this one" : "Swap this pub"}
                  </button>
                </div>

                {swapping ? (
                  <div className="mt-2 max-h-44 overflow-y-auto">
                    {alternatives.length === 0 ? (
                      <p className="py-2 text-center text-[11px] text-muted-foreground">
                        Nothing else round here — every other pub the caddy
                        found is already on the walk.
                      </p>
                    ) : (
                      <ul className="flex flex-col">
                        {alternatives.map((option) => (
                          <li key={option.id}>
                            <button
                              type="button"
                              onClick={() =>
                                dials.swapStop(tapped.stopIndex!, option.id)
                              }
                              className="flex min-h-11 w-full items-center gap-2 border-b border-border/60 px-0.5 text-left last:border-0"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12px] font-semibold">
                                  {option.name}
                                </span>
                                <span className="tabular block text-[10px] text-muted-foreground">
                                  {option.rating != null
                                    ? `${option.rating.toFixed(1)}★ · `
                                    : ""}
                                  {Math.round(option.awayKm * 1000)} m away
                                </span>
                              </span>
                              {/* What it does to the night, said plainly: a
                                  tempting pub that adds a mile has to admit
                                  to adding a mile. */}
                              <span
                                className={cn(
                                  "tabular shrink-0 text-[10px] font-bold",
                                  option.deltaKm > 0.05
                                    ? "text-hazard"
                                    : "text-fairway",
                                )}
                              >
                                {option.deltaKm >= 0 ? "+" : "−"}
                                {Math.abs(Math.round(option.deltaKm * 1000))} m
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}

                {edited ? (
                  <button
                    type="button"
                    onClick={dials.restore}
                    className="mt-1.5 flex min-h-9 w-full items-center justify-center gap-1.5 text-[10px] font-bold text-muted-foreground hover:text-fairway"
                  >
                    <RotateCcw className="size-3" aria-hidden />
                    Back to the caddy&rsquo;s walk
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* The way out. Leaving never cancels: the plan carries on and the
            card lands on the drafting table exactly as it always has. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Leave the gallery — the plan carries on"
          className="absolute top-[max(env(safe-area-inset-top),8px)] right-2 z-30 flex size-11 items-center justify-center rounded-full border border-border bg-card/95 text-muted-foreground shadow-sm hover:text-foreground"
          data-testid="gallery-close"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {/* Below the map: the act's own furniture, on the same tab the course
          room's brief uses. The menu is the reason it retracts — chips, stats,
          two dial rows and two buttons is most of a phone, and the walk those
          controls are steering is drawn on the half of the screen they were
          covering. A refusal is the one thing pinned open. */}
      <RetractingPanel
        open={panelOpen}
        onToggle={
          state.stage === "failed" ? undefined : () => setPanelOpen((up) => !up)
        }
        label={panelLabel}
      >
        {/* The panel itself already clears the home indicator; this is only
            the furniture's own breathing room. */}
        <div className="px-4 pt-1 pb-3">
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
                    aria-checked={index === dials.routeIndex}
                    active={index === dials.routeIndex}
                    onClick={() => dials.pickRoute(index)}
                  >
                    {entry.character}
                  </Chip>
                ))}
              </div>
              {stats ? (
                <p className="text-center text-[11px] text-muted-foreground tabular">
                  {stats}
                </p>
              ) : null}
              {/* The patch's shape, where it is remarkable: two pockets with a
                march between them, or one street. A note on every patch
                would be a note nobody reads. */}
              {state.menu.note ? (
                <p className="text-center font-serif text-[11px] italic text-muted-foreground">
                  {state.menu.note}
                </p>
              ) : null}
              <div
                className="flex flex-wrap items-center gap-1.5"
                aria-label="Holes"
              >
                {HOLE_CHOICES.map((count) => (
                  <Chip
                    key={count}
                    active={dials.holes === count}
                    onClick={() => dials.setDialHoles(count)}
                  >
                    {count}
                  </Chip>
                ))}
                <span className="mx-1 text-[10px] text-muted-foreground">
                  ·
                </span>
                {STRETCH_CHOICES.map((entry) => (
                  <Chip
                    key={entry.id}
                    active={dials.stretch === entry.id}
                    onClick={() => dials.setDialStretch(entry.id)}
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
                    route: stops.length ? stops : null,
                    holes: dials.holes,
                    stretch: dials.stretch,
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
                  onDress({
                    route: null,
                    holes: dials.holes,
                    stretch: dials.stretch,
                  })
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
                  {state.stage === "opening"
                    ? "Walking the patch"
                    : "Dressing the card"}
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
                  {state.stage === "opening"
                    ? "About ten seconds."
                    : "Won’t be long."}
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
                  {state.course.legMinutes.reduce(
                    (sum, leg) => sum + (leg ?? 0),
                    0,
                  )}{" "}
                  min all told.
                </p>
              ) : null}
              <Button
                className="w-full"
                onClick={onClose}
                data-testid="gallery-done"
              >
                Back to the table
              </Button>
            </div>
          ) : null}

          {state.stage === "failed" ? (
            <div className="flex flex-col gap-2">
              <p className="text-center text-xs text-hazard">
                {state.error ??
                  "The caddy lost the ball. Ask again — this one's free."}
              </p>
              <Button
                variant="outline"
                size="compact"
                className="h-11 w-full"
                onClick={onClose}
              >
                Back to the table
              </Button>
            </div>
          ) : null}
        </div>
      </RetractingPanel>
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
  const key = points
    .map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`)
    .join("|");
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
