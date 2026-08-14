"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  APIProvider,
  ColorScheme,
  Map,
  useMap,
} from "@vis.gl/react-google-maps";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { MAPS_BROWSER_KEY, mapId } from "@/lib/maps";
import {
  distanceToStrokeKm,
  simplifyStroke,
  strokeLengthKm,
  type StrokePoint,
} from "@/lib/caddy/stroke";
import { cn } from "@/lib/utils";

/**
 * Draw the walk: the brief's last escalation.
 *
 * Naming an area cannot say *along the river* or *the L through the market*.
 * Here the host draws the walk as a thin line and the swath comes out from
 * it — the width is a dial applied after the stroke, pubs light and drop as
 * it moves, and Done hands the simplified line back to the brief, where it
 * becomes the gather's circles and the router's axis.
 *
 * **Draw mode is a mode.** Drawing on a pannable map dies of gesture
 * ambiguity, so it never shares one: pan and frame first, then *Hold still
 * and draw* freezes the map and one finger draws. Redraw is the edit — a
 * stroke takes two seconds, so vertex editing never needs to exist.
 *
 * The screen-to-world conversion is a linear read of the frozen viewport.
 * Over a city-sized frame the Mercator error is metres, and the swath is
 * hundreds wide — the authoritative geometry (`lib/caddy/stroke.ts`) runs
 * on the latlng line, not on the pixels.
 */

/** The widest view that may be locked, corner to corner. Past a night's
 * walking the density read is meaningless and the fetch is a city — zoom in
 * instead. */
const MAX_LOCK_KM = 6;

const WIDTH_CHOICES = [
  { m: 300, label: "300 m" },
  { m: 500, label: "500 m" },
  { m: 800, label: "800 m" },
] as const;

export function DrawWalkSheet({
  open,
  onOpenChange,
  centre,
  pins,
  onUse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where to frame first — the reach's own centre, when the host has typed
   * an area. Null frames a default view they can pan. */
  centre: { lat: number; lng: number } | null;
  /** The pre-flight's free pins, lighting and dropping as the width moves. */
  pins: { id: string; lat: number; lng: number }[];
  onUse: (stroke: StrokePoint[]) => void;
}) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const [mapsFailed, setMapsFailed] = useState(false);

  if (!MAPS_BROWSER_KEY) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* The height must ride the same data-[side=bottom] variant the sheet
          primitive uses for its own h-auto — a plain h-* merges into a
          different group and loses the specificity contest, the sheet sizes
          to its content, and the flex-1 map area (which has no content of
          its own) collapses to nothing but the bottom controls. The atlas
          sheet learned this first; same fix, same comment. */}
      <SheetContent
        side="bottom"
        className="mx-auto flex max-w-md flex-col gap-0 overflow-hidden rounded-t-2xl p-0 data-[side=bottom]:h-[92dvh]"
      >
        <SheetTitle className="sr-only">Draw the walk</SheetTitle>
        <SheetDescription className="sr-only">
          Frame the map on your patch, hold it still, and draw the walk with
          one finger. The swath around your line is where the caddy will look.
        </SheetDescription>
        {mapsFailed ? (
          <div className="flex flex-1 items-center justify-center px-8 text-center text-xs text-muted-foreground">
            The map would not load — the brief&apos;s own fields still work.
          </div>
        ) : (
          <APIProvider apiKey={MAPS_BROWSER_KEY} onError={() => setMapsFailed(true)}>
            <DrawSurface centre={centre} pins={pins} dark={dark} onUse={onUse} />
          </APIProvider>
        )}
      </SheetContent>
    </Sheet>
  );
}

interface Frozen {
  bounds: { north: number; south: number; east: number; west: number };
  width: number;
  height: number;
}

/**
 * The draw surface itself, exported because the Course Room's map *is* this
 * — there the pen is not a sheet you open, it is the screen you land on.
 * Must sit inside an `APIProvider`; it renders its own `<Map>`.
 */
export function DrawSurface({
  centre,
  pins,
  dark,
  onUse,
  useLabel = "Use this walk",
}: {
  centre: { lat: number; lng: number } | null;
  pins: { id: string; lat: number; lng: number }[];
  dark: boolean;
  onUse: (stroke: StrokePoint[]) => void;
  /** What the commit button says. The sheet hands the walk back to a form;
   * the room plans with it there and then. */
  useLabel?: string;
}) {
  const map = useMap();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const densityRef = useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [frozen, setFrozen] = useState<Frozen | null>(null);
  const [raw, setRaw] = useState<{ x: number; y: number }[]>([]);
  const [stroke, setStroke] = useState<StrokePoint[] | null>(null);
  const [widthM, setWidthM] = useState<number>(500);
  /** Every pub and bar in the locked view, fetched the moment it locks —
   * the density field, and the membership pins while drawing. */
  const [viewPubs, setViewPubs] = useState<
    { id: string; lat: number; lng: number }[] | null
  >(null);
  const [lockNote, setLockNote] = useState<string | null>(null);
  const pointerDown = useRef(false);

  /** The viewport, held still: the whole conversion in one object. */
  function freeze(): Frozen | null {
    const container = surfaceRef.current;
    const bounds = map?.getBounds();
    if (!container || !bounds) return null;
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const rect = container.getBoundingClientRect();
    return {
      bounds: { north: ne.lat(), south: sw.lat(), east: ne.lng(), west: sw.lng() },
      width: rect.width,
      height: rect.height,
    };
  }

  function toWorld(f: Frozen, x: number, y: number): StrokePoint {
    return {
      lat: f.bounds.north - (y / f.height) * (f.bounds.north - f.bounds.south),
      lng: f.bounds.west + (x / f.width) * (f.bounds.east - f.bounds.west),
    };
  }

  function toScreen(f: Frozen, p: StrokePoint): { x: number; y: number } {
    return {
      x: ((p.lng - f.bounds.west) / (f.bounds.east - f.bounds.west)) * f.width,
      y: ((f.bounds.north - p.lat) / (f.bounds.north - f.bounds.south)) * f.height,
    };
  }

  /** Pixels per kilometre across the frozen frame, for the swath's width. */
  function pxPerKm(f: Frozen): number {
    const acrossKm =
      (f.bounds.east - f.bounds.west) *
      111.32 *
      Math.cos((((f.bounds.north + f.bounds.south) / 2) * Math.PI) / 180);
    return acrossKm > 0 ? f.width / acrossKm : 0;
  }

  const widthKm = widthM / 1000;
  const activePins = viewPubs ?? pins;
  const inSwath = stroke
    ? activePins.filter((pin) => distanceToStrokeKm(pin, stroke) <= widthKm)
    : [];
  const inIds = new Set(inSwath.map((pin) => pin.id));

  /** Kilometres across the frozen frame, corner to corner-ish. */
  function acrossKm(f: Frozen): number {
    return (
      (f.bounds.east - f.bounds.west) *
      111.32 *
      Math.cos((((f.bounds.north + f.bounds.south) / 2) * Math.PI) / 180)
    );
  }

  function begin() {
    const f = freeze();
    if (!f) return;
    // Within reason: a locked view is a fetch and a density read, and past a
    // night's walking both are meaningless. Zoom in, then lock.
    if (acrossKm(f) > MAX_LOCK_KM) {
      setLockNote("Zoom in a little — that view is more than a night's walking.");
      return;
    }
    setLockNote(null);
    setFrozen(f);
    setDrawing(true);
    setStroke(null);
    setRaw([]);
    setViewPubs(null);
    // Every pub and bar in the locked view. The same free search the builder
    // makes, aimed by bounds — the answer is the density field.
    void fetch("/api/places/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bounds: f.bounds }),
    })
      .then((response) => response.json())
      .then((data: { results?: { id: string; lat: number | null; lng: number | null }[] }) => {
        setViewPubs(
          (data.results ?? [])
            .filter(
              (row): row is { id: string; lat: number; lng: number } =>
                row.lat != null && row.lng != null,
            )
            .map((row) => ({ id: row.id, lat: row.lat, lng: row.lng })),
        );
      })
      .catch(() => setViewPubs(null));
  }

  function finish(points: { x: number; y: number }[]) {
    if (!frozen || points.length < 2) return;
    const world = points.map((p) => toWorld(frozen, p.x, p.y));
    setStroke(simplifyStroke(world, widthKm / 3));
  }

  /**
   * The density field, painted once per lock: a soft blob per pub, overlaps
   * summing into brightness. Bright is busy; dark is dead ground — the map
   * telling the host where a walk can actually live before they draw one.
   * A canvas because sixty translucent gradients is what canvases are for.
   */
  useEffect(() => {
    const canvas = densityRef.current;
    if (!canvas || !frozen) return;
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(frozen.width * scale);
    canvas.height = Math.round(frozen.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, frozen.width, frozen.height);
    if (!viewPubs?.length) return;
    const base = dark ? "rgba(127, 176, 141, " : "rgba(30, 70, 48, ";
    const r = Math.max(24, 0.35 * pxPerKm(frozen));
    for (const pub of viewPubs) {
      const at = toScreen(frozen, pub);
      const blob = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, r);
      blob.addColorStop(0, `${base}0.16)`);
      blob.addColorStop(1, `${base}0)`);
      ctx.fillStyle = blob;
      ctx.beginPath();
      ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Painting only — no state is set here, so the effect cannot cascade.
  }, [viewPubs, frozen, dark]);

  const strokePx =
    frozen && stroke ? stroke.map((p) => toScreen(frozen, p)) : null;
  const path = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <div className="relative min-h-0 flex-1" ref={surfaceRef}>
      <Map
        className="size-full"
        mapId={mapId()}
        colorScheme={dark ? ColorScheme.DARK : ColorScheme.LIGHT}
        defaultCenter={centre ?? { lat: 51.5072, lng: -0.1276 }}
        defaultZoom={centre ? 14 : 12}
        gestureHandling={drawing ? "none" : "greedy"}
        disableDefaultUI
        keyboardShortcuts={false}
        clickableIcons={false}
      >
        {activePins.map((pin) => (
          <AdvancedMarker
            key={pin.id}
            position={{ lat: pin.lat, lng: pin.lng }}
            anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
          >
            <div
              className={cn(
                "rounded-full transition-all duration-300",
                inIds.has(pin.id)
                  ? "size-3.5 bg-fairway ring-2 ring-background"
                  : "size-1.5 bg-muted-foreground/40",
              )}
            />
          </AdvancedMarker>
        ))}
      </Map>

      {/* The density field, under the pen: bright is busy, dark is dead
          ground. Locked-view only — it is a picture of the frozen frame. */}
      {drawing && frozen ? (
        <canvas
          ref={densityRef}
          className="pointer-events-none absolute inset-0 z-[5]"
          style={{ width: "100%", height: "100%" }}
          aria-hidden
        />
      ) : null}
      {/* The drawing surface: present only in draw mode, so panning and
          drawing never share a gesture. */}
      {drawing && frozen ? (
        <div
          className="absolute inset-0 z-10 cursor-crosshair touch-none"
          onPointerDown={(event) => {
            pointerDown.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            const rect = event.currentTarget.getBoundingClientRect();
            setRaw([{ x: event.clientX - rect.left, y: event.clientY - rect.top }]);
            setStroke(null);
          }}
          onPointerMove={(event) => {
            if (!pointerDown.current) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const point = {
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
            };
            setRaw((current) => {
              const last = current[current.length - 1];
              if (last && Math.hypot(point.x - last.x, point.y - last.y) < 4) {
                return current;
              }
              return [...current, point];
            });
          }}
          onPointerUp={() => {
            pointerDown.current = false;
            setRaw((current) => {
              finish(current);
              return current;
            });
          }}
          onPointerCancel={() => {
            pointerDown.current = false;
          }}
        >
          <svg className="size-full" aria-hidden>
            {strokePx ? (
              <path
                d={path(strokePx)}
                fill="none"
                stroke="var(--color-fairway)"
                strokeOpacity={0.14}
                strokeWidth={Math.max(8, 2 * widthKm * pxPerKm(frozen))}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            {raw.length > 1 && !strokePx ? (
              <path
                d={path(raw)}
                fill="none"
                stroke="var(--color-fairway)"
                strokeOpacity={0.5}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            {strokePx ? (
              <path
                d={path(strokePx)}
                fill="none"
                stroke="var(--color-fairway)"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </svg>
        </div>
      ) : null}

      <span className="pointer-events-none absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border bg-card/95 px-3 py-1 text-[11px] font-semibold whitespace-nowrap shadow-sm">
        {lockNote
          ? lockNote
          : drawing
            ? stroke
              ? `${inSwath.length} pubs in the swath · ${strokeLengthKm(stroke).toFixed(1)} km drawn`
              : viewPubs
                ? `${viewPubs.length} pubs in view — bright is busy, dark is dead ground`
                : "One finger draws the walk"
            : "Frame your patch, then hold it still"}
      </span>

      {/* The controls: the mode switch, the width dial, the two ways out. */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 bg-gradient-to-t from-background via-background/85 to-transparent px-4 pt-8 pb-[max(env(safe-area-inset-bottom),12px)]">
        {drawing ? (
          <>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {WIDTH_CHOICES.map((choice) => (
                <Chip
                  key={choice.m}
                  active={widthM === choice.m}
                  onClick={() => setWidthM(choice.m)}
                >
                  {choice.label}
                </Chip>
              ))}
              <Chip
                onClick={() => {
                  setStroke(null);
                  setRaw([]);
                }}
              >
                Redraw
              </Chip>
              <Chip
                onClick={() => {
                  setDrawing(false);
                  setStroke(null);
                  setRaw([]);
                }}
              >
                Pan the map
              </Chip>
            </div>
            <Button
              className="w-full"
              disabled={!stroke}
              onClick={() => stroke && onUse(stroke)}
              data-testid="use-drawn-walk"
            >
              {useLabel}
            </Button>
          </>
        ) : (
          <Button className="w-full" onClick={begin} data-testid="hold-and-draw">
            Hold still &amp; draw
          </Button>
        )}
      </div>
    </div>
  );
}
