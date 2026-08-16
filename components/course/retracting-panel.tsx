"use client";

import type { ReactNode } from "react";
import { Clock, Flag, Route } from "lucide-react";

import { panelSlots } from "@/lib/caddy/panel";
import { cn } from "@/lib/utils";

/**
 * The panel under a map: all the way up, or all the way down.
 *
 * Two screens stand furniture beneath a full-bleed map — the course room's
 * brief and the gallery's menu — and both learn the same lesson. Peeked at a
 * quarter of the screen a panel is neither thing: too small to work in, big
 * enough to take the map's bottom third. So the behaviour lives here, once,
 * rather than in two places that drift apart the first time one is touched.
 *
 * **The handle is a handle, and the status is a bar.** This used to be one
 * line of text that said something different at every act — "The brief", "The
 * brief · walk drawn", "The walks · the long way", "Dressing the card", "The
 * card · 9 holes" — under a chevron that flipped. Five wordings, five widths,
 * on the one control a host reaches for most, so there was never anything
 * constant to aim at. Now: a grabber that is always the same 36 pixels over
 * three slots with three fixed icons, where only the figures change. The
 * furniture stops moving; the numbers do the talking.
 *
 * **It floats over the map; it does not squeeze it.** As a flex sibling the
 * panel took its height *out* of the map, so opening the drawer resized the
 * map — and a Google map keeps its centre through a resize, which means the
 * ground under it re-frames: the walk slid up the glass, the pins moved, and
 * nothing was where it had been a moment ago. Absolutely positioned over the
 * map region instead, the map is one fixed canvas and the sheet slides across
 * it, which is what every map app does and the only arrangement where opening
 * the drawer moves nothing at all.
 *
 * **Only the body collapses.** The cap used to sit on the whole panel with a
 * magic number for the tab's own height — which meant the one control that
 * reopens the panel was inside the thing being clipped, and every change to it
 * had to re-derive that number or lose a few pixels off the bottom of the only
 * way back in. The handle and the slots now sit outside the collapsing box
 * entirely, so they cannot be clipped by arithmetic going stale.
 *
 * Hidden rather than scrollable when down, deliberately: a collapsed panel
 * that can still be scrolled inside a two-line window is a trap.
 *
 * Omitting `onToggle` pins the panel open. That is for the one case where
 * retracting is wrong — a refusal has to stay readable — and not a general
 * off switch.
 */
export function RetractingPanel({
  open,
  onToggle,
  holes = null,
  km = null,
  children,
  className,
}: {
  open: boolean;
  onToggle?: () => void;
  /** Stops on the walk in hand, or null before there is one. */
  holes?: number | null;
  /** How far that walk is, or null. */
  km?: number | null;
  children: ReactNode;
  className?: string;
}) {
  const retractable = onToggle != null;
  const slots = panelSlots({ holes, km });

  // **The handle is the whole bar, not the grabber.** A 4px pill is the right
  // *paint* for a drag handle and a hopeless tap target, so the target is the
  // grabber and the figures together — a little over sixty pixels, and the
  // convention every map app already teaches.
  const head = (
    <>
      <span className="flex justify-center py-2.5">
        <span
          aria-hidden
          className="block h-1 w-9 rounded-full bg-border transition-colors"
        />
      </span>
      <span className="grid grid-cols-3 border-y border-border">
        <PanelSlot icon={<Flag className="size-3.5" aria-hidden />}>
          {slots.holes}
        </PanelSlot>
        <PanelSlot icon={<Route className="size-3.5" aria-hidden />} divided>
          {slots.walk}
        </PanelSlot>
        <PanelSlot icon={<Clock className="size-3.5" aria-hidden />} divided>
          {slots.time}
        </PanelSlot>
      </span>
    </>
  );

  return (
    <div
      className={cn(
        "rounded-t-2xl border-t border-border bg-card shadow-[0_-6px_24px_rgba(0,0,0,0.12)]",
        className,
      )}
    >
      <div className="mx-auto w-full max-w-md">
        {retractable ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? "Hide the panel" : "Show the panel"}
            className="block w-full"
          >
            {head}
          </button>
        ) : (
          head
        )}

        {/* **The map keeps a floor.** At a flat 82dvh the panel took the
            screen and left the map about a hundred pixels — on the surface
            whose entire premise is the map, with the draw surface's own
            absolutely-positioned furniture piling up inside the remainder.
            The panel scrolls; the map cannot.

            The safe-area padding rides *inside* this box so it collapses with
            it: on the outer element it was padding a two-line window out to
            the height of a home indicator for no reason. */}
        <div
          className={cn(
            "transition-[max-height] duration-300 motion-reduce:transition-none",
            open || !retractable
              ? "max-h-[min(82dvh,calc(100dvh-18rem))] overflow-y-auto"
              : "max-h-0 overflow-hidden",
          )}
        >
          {/* **The body's padding lives here, once.** Each screen used to
              bring its own — the room `pt-2`, the gallery `pt-1` — so the
              first thing under the slot bar sat four pixels from it on one
              screen and eight on the other, and the waiting card had a
              different gap above it than below. One declaration, every stage.
              `gap-3` for the same reason: two blocks in the panel are spaced
              by the panel, not by whichever one happened to set a margin. */}
          <div className="flex flex-col gap-3 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function PanelSlot({
  icon,
  divided = false,
  children,
}: {
  icon: ReactNode;
  divided?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "tabular flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold",
        divided && "border-l border-border",
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      {children}
    </span>
  );
}
