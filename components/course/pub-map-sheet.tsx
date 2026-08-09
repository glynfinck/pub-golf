"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  APIProvider,
  ColorScheme,
  Map,
  Polyline,
  useMap,
  type MapCameraChangedEvent,
  type MapEvent,
} from "@vis.gl/react-google-maps";
import { Check, LocateFixed, Plus, Search } from "lucide-react";
import type { DraftHole } from "@/components/course/hole-editor";
import type { FoundPub } from "@/components/course/place-search";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { PuttGreen } from "@/components/ui/putt";
import { Skeleton } from "@/components/ui/skeleton";
import {
  boundsAround,
  estimateWalkMinutes,
  type Bounds,
  type LatLng,
} from "@/lib/geo";
import { MAP_STYLE_ID, mapId, MAPS_BROWSER_KEY } from "@/lib/maps";
import { fetchIpBias, searchNote, searchPubs } from "@/lib/pub-search";
import { cn } from "@/lib/utils";
import type { Tables } from "@/types/supabase-helpers";

type VenueResult = Tables<"venues">;

/** Whatever the map has yet to be told, the whole world is on it. */
const WORLD = { center: { lat: 20, lng: 0 }, zoom: 2 };

/**
 * The pop-up course atlas: the same pub search the list runs, on a
 * cloud-styled map that wears the active theme. Candidates land as pint
 * pins, the holes already on the card are numbered and joined by their
 * walking line, and panning offers "Search this patch" rather than
 * re-searching under the player's thumb.
 */
export function PubMapSheet({
  open,
  onOpenChange,
  initialQuery,
  holes,
  onAdd,
  actionLabel = "Add",
  actionAria,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whatever was in the builder's search field when the map was opened. */
  initialQuery: string;
  holes: DraftHole[];
  onAdd: (pub: FoundPub) => void;
  /** The word on every result's button — the map answers the same three
   * questions the list does: add at the end, insert, change the pub. */
  actionLabel?: string;
  actionAria?: (venueName: string) => string;
}) {
  // The player's city, prefetched while the course is still being typed:
  // just the request's geo headers echoed back, nothing spent. The sheet
  // then opens already framed on the right city instead of showing the
  // whole world for the beat the first search takes.
  const [homeBias, setHomeBias] = useState<LatLng | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchIpBias().then((found) => {
      if (!cancelled && found) setHomeBias(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* The height must ride the same data-[side=bottom] variant the sheet
          primitive uses for its own h-auto: a plain h-* merges into a
          different group and loses the specificity contest, the sheet sizes
          to its content, and twenty result rows push the map, the pill and
          the close button clean off the top of the screen. */}
      <SheetContent
        side="bottom"
        className="mx-auto flex max-w-md flex-col gap-0 overflow-hidden rounded-t-2xl p-0 data-[side=bottom]:h-[92dvh]"
      >
        <SheetTitle className="sr-only">Find pubs on the map</SheetTitle>
        <SheetDescription className="sr-only">
          Search pubs, pan the map, and add them to the course. The list
          below the map carries every result.
        </SheetDescription>
        <PubMapBody
          initialQuery={initialQuery}
          holes={holes}
          onAdd={onAdd}
          homeBias={homeBias}
          actionLabel={actionLabel}
          actionAria={actionAria}
        />
      </SheetContent>
    </Sheet>
  );
}

/** Mounted fresh on every open, so the camera and query start honest. */
function PubMapBody({
  initialQuery,
  holes,
  onAdd,
  homeBias,
  actionLabel,
  actionAria,
}: {
  initialQuery: string;
  holes: DraftHole[];
  onAdd: (pub: FoundPub) => void;
  /** The player's IP city, when the builder had it ready before open. */
  homeBias: LatLng | null;
  actionLabel: string;
  actionAria?: (venueName: string) => string;
}) {
  const nameFor =
    actionAria ?? ((name: string) => `Add ${name} as hole ${holes.length + 1}`);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<VenueResult[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | undefined>(undefined);
  const [moved, setMoved] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [located, setLocated] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateNote, setLocateNote] = useState<string | null>(null);
  const [mapsFailed, setMapsFailed] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  // Orienting: the sheet opened before anyone knew where to look — no
  // course on the map, no city prefetched. The world sits under a veil
  // until the first honest frame arrives (the city, a search fit, or the
  // results saying there is nothing to frame).
  const [orienting, setOrienting] = useState(
    () => holes.every((hole) => hole.lat == null) && homeBias == null,
  );

  const requestSeq = useRef(0);
  const mapHandle = useRef<google.maps.Map | null>(null);
  const viewportRef = useRef<Bounds | null>(null);
  const settledRef = useRef(false);
  const programmaticRef = useRef(false);
  const pendingFitRef = useRef<(() => void) | null>(null);
  const rowRefs = useRef(new globalThis.Map<string, HTMLDivElement>());
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (addedTimer.current) clearTimeout(addedTimer.current);
    },
    [],
  );

  // Google reports a refused key (wrong referrer, missing API) through this
  // one global callback, not through the loader — without it the map area
  // just sits blank. Caught, the sheet says what happened and the list
  // keeps working.
  useEffect(() => {
    const w = window as Window & { gm_authFailure?: () => void };
    const prior = w.gm_authFailure;
    w.gm_authFailure = () => setMapsFailed(true);
    return () => {
      w.gm_authFailure = prior;
    };
  }, []);

  const holePins = holes
    .map((hole, index) => ({ hole, number: index + 1 }))
    .filter(
      (
        pin,
      ): pin is { hole: DraftHole & { lat: number; lng: number }; number: number } =>
        pin.hole.lat != null && pin.hole.lng != null,
    );

  const fitTo = useCallback((venues: VenueResult[], bias: LatLng | null) => {
    const coords = venues.filter(
      (venue): venue is VenueResult & { lat: number; lng: number } =>
        venue.lat != null && venue.lng != null,
    );
    const apply = () => {
      const map = mapHandle.current;
      if (!map) return;
      programmaticRef.current = true;
      if (coords.length >= 2) {
        map.fitBounds(
          {
            north: Math.max(...coords.map((c) => c.lat)),
            south: Math.min(...coords.map((c) => c.lat)),
            east: Math.max(...coords.map((c) => c.lng)),
            west: Math.min(...coords.map((c) => c.lng)),
          },
          56,
        );
      } else if (coords.length === 1) {
        map.panTo({ lat: coords[0].lat, lng: coords[0].lng });
        map.setZoom(15);
      } else if (bias) {
        map.panTo(bias);
        map.setZoom(13);
      } else {
        programmaticRef.current = false;
      }
    };
    if (mapHandle.current) apply();
    // The pill can answer before the map exists; frame it on arrival.
    else pendingFitRef.current = apply;
  }, []);

  const runSearch = useCallback(
    async (
      input: { query?: string; bounds?: Bounds },
      opts: { fit: boolean },
    ) => {
      const seq = ++requestSeq.current;
      setSearching(true);
      try {
        const data = await searchPubs(input);
        if (seq !== requestSeq.current) return;
        setDegraded(data.degraded);
        setResults(data.results);
        setSearchError(data.error);
        setSelectedId(null);
        setMoved(false);
        if (opts.fit) fitTo(data.results, data.bias);
      } catch {
        if (seq === requestSeq.current) {
          setResults([]);
          setSearchError("failed");
        }
      } finally {
        if (seq === requestSeq.current) {
          setSearching(false);
          // Whatever came back, the map now shows the truest frame it
          // will get without the player's help.
          setOrienting(false);
        }
      }
    },
    [fitTo],
  );

  // The pill: the builder's debounced text search, fitted to what it finds.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) return;
    const timeout = setTimeout(() => {
      void runSearch({ query: trimmed }, { fit: true });
    }, 350);
    return () => clearTimeout(timeout);
  }, [query, runSearch]);

  // The city can arrive after the map does — the sheet opened faster than
  // /api/geo answered. Frame it the moment it is known, unless something
  // truer (a search fit, the player's own hand) got there first.
  useEffect(() => {
    if (!orienting || !homeBias) return;
    const timeout = setTimeout(() => {
      const map = mapHandle.current;
      if (!map) return;
      programmaticRef.current = true;
      map.panTo(homeBias);
      map.setZoom(13);
      setOrienting(false);
    }, 0);
    return () => clearTimeout(timeout);
  }, [orienting, homeBias]);

  function handleCameraChanged(event: MapCameraChangedEvent) {
    viewportRef.current = event.detail.bounds;
    if (settledRef.current && !programmaticRef.current) setMoved(true);
  }

  function handleIdle(event: MapEvent) {
    if (pendingFitRef.current) {
      const apply = pendingFitRef.current;
      pendingFitRef.current = null;
      settledRef.current = true;
      apply();
      return;
    }
    if (!settledRef.current) {
      settledRef.current = true;
      // The map may have mounted before the prefetched city was in hand;
      // frame it now rather than opening on the world.
      if (orienting && homeBias) {
        programmaticRef.current = true;
        event.map.panTo(homeBias);
        event.map.setZoom(13);
        setOrienting(false);
      }
      // The sheet's opening question, when the pill didn't bring one:
      // what's on this patch — the course's if it framed one, the
      // player's city otherwise (the route aims by IP with no bounds).
      if (initialQuery.trim().length < 3) {
        if (holePins.length > 0)
          void runSearch(
            { bounds: viewportRef.current ?? undefined },
            { fit: false },
          );
        else void runSearch({}, { fit: true });
      }
      return;
    }
    programmaticRef.current = false;
  }

  function searchThisPatch() {
    const bounds = viewportRef.current;
    if (!bounds) return;
    const trimmed = query.trim();
    void runSearch(
      trimmed.length >= 3 ? { query: trimmed, bounds } : { bounds },
      { fit: false },
    );
  }

  function locate() {
    if (locating) return;
    if (!("geolocation" in navigator)) {
      setLocateNote("No location on this phone — pan the map instead.");
      return;
    }
    setLocating(true);
    setLocateNote(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const here = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setLocating(false);
        setLocated(here);
        const map = mapHandle.current;
        programmaticRef.current = true;
        map?.panTo(here);
        map?.setZoom(15);
        void runSearch({ bounds: boundsAround(here, 1_000) }, { fit: false });
      },
      (geoError) => {
        setLocating(false);
        setLocateNote(
          geoError.code === geoError.PERMISSION_DENIED
            ? "Location is off for this site — pan the map instead."
            : "No fix on you — pan the map instead.",
        );
      },
      { timeout: 8_000, maximumAge: 60_000 },
    );
  }

  function selectFromPin(id: string) {
    setSelectedId(id);
    rowRefs.current.get(id)?.scrollIntoView({ block: "nearest" });
  }

  function selectFromRow(venue: VenueResult) {
    setSelectedId(venue.id);
    if (venue.lat != null && venue.lng != null) {
      const map = mapHandle.current;
      programmaticRef.current = true;
      map?.panTo({ lat: venue.lat, lng: venue.lng });
    }
  }

  function addVenue(venue: VenueResult) {
    onAdd({
      venue_id: venue.id,
      venue_name: venue.name,
      address: venue.address,
      rating: venue.rating,
      lat: venue.lat,
      lng: venue.lng,
    });
    setJustAdded(venue.id);
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setJustAdded(null), 1400);
  }

  const holeNumberFor = (venueId: string) => {
    const index = holes.findIndex((hole) => hole.venue_id === venueId);
    return index === -1 ? null : index + 1;
  };

  const frame =
    holePins.length >= 2
      ? {
          bounds: {
            north: Math.max(...holePins.map((p) => p.hole.lat)),
            south: Math.min(...holePins.map((p) => p.hole.lat)),
            east: Math.max(...holePins.map((p) => p.hole.lng)),
            west: Math.min(...holePins.map((p) => p.hole.lng)),
          },
        }
      : holePins.length === 1
        ? {
            center: {
              lat: holePins[0].hole.lat,
              lng: holePins[0].hole.lng,
            },
            zoom: 14,
          }
        : homeBias
          ? { center: homeBias, zoom: 13 }
          : WORLD;

  return (
    <APIProvider apiKey={MAPS_BROWSER_KEY} onError={() => setMapsFailed(true)}>
      <div className="relative min-h-0 flex-1">
        {mapsFailed ? (
          <div className="flex h-full items-center justify-center px-8 text-center text-xs text-muted-foreground">
            The map would not load — the search below still works, and the
            list under the builder&apos;s field always does.
          </div>
        ) : (
          <Map
            key={dark ? "midnight" : "cream"}
            mapId={mapId()}
            // The scheme is the selector: the map ID carries a style per
            // background (light and dark slots), and colorScheme picks
            // which one renders — cream by day, Midnight after dark. The
            // unstyled fallback follows the app theme by the same switch.
            colorScheme={dark ? ColorScheme.DARK : ColorScheme.LIGHT}
            {...("bounds" in frame
              ? { defaultBounds: { ...frame.bounds, padding: 64 } }
              : { defaultCenter: frame.center, defaultZoom: frame.zoom })}
            disableDefaultUI
            clickableIcons={false}
            gestureHandling="greedy"
            onCameraChanged={handleCameraChanged}
            onIdle={handleIdle}
            className="h-full w-full"
          >
            <WalkingLine holePins={holePins} />
            {holePins.map(({ hole, number }) => (
              <AdvancedMarker
                key={`hole-${number}`}
                position={{ lat: hole.lat, lng: hole.lng }}
                anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
                title={`Hole ${number} · ${hole.venue_name}`}
              >
                <div className="flex size-7 items-center justify-center rounded-full border-2 border-background bg-fairway font-serif text-xs font-bold text-background shadow-md">
                  {number}
                </div>
              </AdvancedMarker>
            ))}
            {/* A result that joined the card stops being a candidate: its
                pint pin retires and the numbered hole ring stands alone,
                rather than the two stacking on one rooftop. */}
            {results.map((venue) =>
              venue.lat != null &&
              venue.lng != null &&
              holeNumberFor(venue.id) == null ? (
                <AdvancedMarker
                  key={venue.id}
                  position={{ lat: venue.lat, lng: venue.lng }}
                  anchorPoint={AdvancedMarkerAnchorPoint.BOTTOM_CENTER}
                  zIndex={selectedId === venue.id ? 2 : 1}
                  title={venue.name}
                  onClick={() => selectFromPin(venue.id)}
                >
                  <div
                    className={cn(
                      "flex flex-col items-center transition-transform duration-150",
                      selectedId === venue.id && "scale-125",
                    )}
                  >
                    <div className="flex size-8 items-center justify-center rounded-full border-2 border-background bg-marker text-accent-foreground shadow-md">
                      <PintGlyph />
                    </div>
                    <div className="-mt-px h-0 w-0 border-x-4 border-t-6 border-x-transparent border-t-marker" />
                  </div>
                </AdvancedMarker>
              ) : null,
            )}
            {located ? (
              <AdvancedMarker
                position={located}
                anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
                title="You"
              >
                <div className="size-3.5 rounded-full border-2 border-background bg-fairway ring-4 ring-fairway/25" />
              </AdvancedMarker>
            ) : null}
          </Map>
        )}
        <MapHandle handleRef={mapHandle} />

        {orienting && !mapsFailed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background">
            <PuttGreen className="max-w-56 px-6 text-muted-foreground" />
            <p className="eyebrow">Finding your patch</p>
          </div>
        ) : null}

        <div className="absolute top-3 right-14 left-3">
          <div className="relative">
            <Search
              size={15}
              aria-hidden
              className="absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Search pubs on the map"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="The Auld Shillelagh…"
              // dark:bg-card outranks the primitive's translucent
              // dark:bg-input/30 — a see-through pill floating on a live
              // map reads as broken, not glassy.
              className="min-h-11 rounded-full bg-card pl-9 shadow-md dark:bg-card"
            />
          </div>
        </div>

        <button
          type="button"
          aria-label="Find pubs near me"
          onClick={locate}
          className="absolute top-16 right-3 flex size-11 items-center justify-center rounded-full border border-border bg-card text-fairway shadow-md"
        >
          <LocateFixed
            size={18}
            aria-hidden
            className={cn(locating && "animate-pulse")}
          />
        </button>

        {moved && !searching && !mapsFailed ? (
          <button
            type="button"
            onClick={searchThisPatch}
            className="absolute top-16 left-1/2 flex min-h-9 -translate-x-1/2 items-center rounded-full bg-fairway px-4 text-xs font-bold whitespace-nowrap text-primary-foreground shadow-md"
          >
            Search this patch
          </button>
        ) : null}
      </div>

      <div className="flex h-[42%] min-h-44 shrink-0 flex-col border-t border-border bg-card">
        <div className="px-4 pt-2.5 pb-1">
          <p className="eyebrow">
            {searching
              ? "Scouting the patch…"
              : `${results.length} ${results.length === 1 ? "pub" : "pubs"} on this patch`}
          </p>
          {locateNote ? (
            <p className="text-[11px] text-muted-foreground">{locateNote}</p>
          ) : null}
          {degraded ? (
            <p className="text-[11px] text-muted-foreground">
              Pub search needs a Google Places key on the server — the map
              can look, but only add-by-name can build.
            </p>
          ) : null}
          {!MAP_STYLE_ID ? (
            <p className="text-[11px] text-muted-foreground">
              This build carries no map style ID — the map wears
              Google&apos;s stock look until it reaches the deploy.
            </p>
          ) : null}
          {!degraded && searchNote(searchError) ? (
            <p className="text-[11px] text-muted-foreground">
              {searchNote(searchError)}
            </p>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {searching && results.length === 0 ? (
            // Result-shaped placeholders: the list says where the pubs will
            // land, rather than a spinner saying only "wait".
            <div aria-hidden>
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="flex min-h-13 items-center gap-2.5 border-b border-dotted border-border py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <Skeleton className="mb-1.5 h-4 w-2/5" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                  <Skeleton className="h-10 w-19 rounded-full" />
                </div>
              ))}
            </div>
          ) : null}
          {results.length === 0 && !searching && !degraded && !searchError ? (
            <p className="pt-2 text-[11px] text-muted-foreground">
              No pubs on this patch — pan the map and search again, widen
              the net, or add by name from the builder.
            </p>
          ) : null}
          {results.map((venue) => {
            const onCard = holeNumberFor(venue.id);
            return (
              <div
                key={venue.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(venue.id, el);
                  else rowRefs.current.delete(venue.id);
                }}
                className={cn(
                  "flex min-h-13 items-center gap-2.5 border-b border-dotted border-border py-1.5",
                  selectedId === venue.id && "-mx-2 rounded-lg bg-secondary px-2",
                )}
              >
                <button
                  type="button"
                  onClick={() => selectFromRow(venue)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-sm font-bold">{venue.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {venue.address}
                    {venue.rating ? ` · ★ ${venue.rating}` : ""}
                    {located && venue.lat != null && venue.lng != null
                      ? ` · ${estimateWalkMinutes(located, venue)} min walk`
                      : ""}
                    {onCard ? ` · hole ${onCard} on the card` : ""}
                  </div>
                </button>
                <button
                  type="button"
                  aria-label={nameFor(venue.name)}
                  onClick={() => addVenue(venue)}
                  className={cn(
                    "flex min-h-10 shrink-0 items-center gap-1 rounded-full border-[1.5px] border-fairway px-3.5 text-xs font-bold transition-colors duration-200",
                    justAdded === venue.id
                      ? "bg-fairway text-primary-foreground"
                      : "text-fairway",
                  )}
                >
                  {justAdded === venue.id ? (
                    <>
                      <Check
                        size={13}
                        aria-hidden
                        className="animate-in zoom-in-50 duration-200"
                      />
                      Added
                    </>
                  ) : (
                    <>
                      <Plus size={13} aria-hidden /> {actionLabel}
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </APIProvider>
  );
}

/** Hands the map instance to the body's imperative moments (pan, fit). */
function MapHandle({
  handleRef,
}: {
  handleRef: React.RefObject<google.maps.Map | null>;
}) {
  const map = useMap();
  useEffect(() => {
    handleRef.current = map;
  }, [map, handleRef]);
  return null;
}

/**
 * The walking line: leader dots between the holes already on the card,
 * with the minutes chip at each leg's midpoint — the course taking shape
 * while it is built.
 */
function WalkingLine({
  holePins,
}: {
  holePins: { hole: DraftHole & { lat: number; lng: number }; number: number }[];
}) {
  // The dots draw on canvas, which needs a resolved color, not a CSS var.
  // Read the token once per mount; the map remounts with the theme, so it
  // never goes stale.
  const [ink] = useState(() =>
    typeof window === "undefined"
      ? ""
      : getComputedStyle(document.documentElement)
          .getPropertyValue("--marker")
          .trim(),
  );
  if (holePins.length < 2 || !ink) return null;

  const legs = holePins.slice(1).map((pin, index) => {
    const from = holePins[index].hole;
    const to = pin.hole;
    return {
      key: `leg-${index}`,
      midpoint: {
        lat: (from.lat + to.lat) / 2,
        lng: (from.lng + to.lng) / 2,
      },
      minutes: estimateWalkMinutes(from, to),
    };
  });

  return (
    <>
      <Polyline
        path={holePins.map(({ hole }) => ({ lat: hole.lat, lng: hole.lng }))}
        strokeOpacity={0}
        icons={[
          {
            icon: {
              // A dot, drawn as a path so nothing needs the google global
              // at render time.
              path: "M0,0m-1,0a1,1 0 1,0 2,0a1,1 0 1,0 -2,0",
              fillColor: ink,
              fillOpacity: 1,
              strokeOpacity: 0,
              scale: 2.5,
            },
            offset: "0",
            repeat: "14px",
          },
        ]}
      />
      {legs.map((leg) =>
        leg.minutes ? (
          <AdvancedMarker
            key={leg.key}
            position={leg.midpoint}
            anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
          >
            <div className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-bold text-muted-foreground shadow-sm">
              {leg.minutes} min
            </div>
          </AdvancedMarker>
        ) : null,
      )}
    </>
  );
}

/** The house pint, sized for a pin plate. */
function PintGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="currentColor"
      aria-hidden
    >
      <rect x="3.4" y="0.4" width="9.2" height="1.8" rx="0.9" />
      <path d="M4 3h8l-.9 10.7a1.6 1.6 0 0 1-1.6 1.5H6.5a1.6 1.6 0 0 1-1.6-1.5L4 3z" />
    </svg>
  );
}
