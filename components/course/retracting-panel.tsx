"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

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
 * **The tab is the status line.** Down, the panel *is* a single row of text,
 * so whatever it says has to earn the row it costs: "The walks · the long
 * way", "Dressing the card", "The brief · walk drawn". A host who retracted
 * the panel to look at the map still knows what is waiting under it, which is
 * what makes retracting safe to offer at every stage.
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
  label,
  openLabel = "The map",
  children,
}: {
  open: boolean;
  onToggle?: () => void;
  /** What the tab says when the panel is down. */
  label: string;
  /** What it says when the panel is up — where pressing it leads. */
  openLabel?: string;
  children: ReactNode;
}) {
  const retractable = onToggle != null;
  return (
    <div
      className={cn(
        "shrink-0 rounded-t-2xl border-t border-border bg-card shadow-[0_-6px_24px_rgba(0,0,0,0.12)]",
        "transition-[max-height] duration-300 motion-reduce:transition-none",
        open || !retractable
          ? "max-h-[82dvh] overflow-y-auto"
          : // The cap covers the border too — Tailwind's preflight makes this
            // a border-box, so a bare 2.75rem cap eats a pixel of the 44px
            // button it is supposed to be exactly tall enough for.
            "max-h-[calc(2.75rem+1px)] overflow-hidden",
      )}
    >
      {/*
       * **The safe-area padding lives here, not on the capped box.**
       * It used to sit on the element above, which is also the one clamped to
       * 44px when the panel is down — and a border-box cap *includes* its own
       * padding. On any phone with a home indicator the tab was rendering at
       * about 35 of its 44 pixels, clipped from below, and the tab is the only
       * way into the brief. The cap now measures the tab and nothing else.
       */}
      <div className="mx-auto w-full max-w-md pb-[max(env(safe-area-inset-bottom),8px)]">
        {retractable ? (
          // No aria-label: the visible text is the accessible name, and
          // aria-expanded carries the state. A label that restated the text
          // in other words would only give a screen reader a different button
          // from the one on the glass.
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex min-h-11 w-full items-center justify-center gap-1.5 px-4 text-center text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
          >
            {open ? (
              <ChevronDown size={13} className="shrink-0" aria-hidden />
            ) : (
              <ChevronUp size={13} className="shrink-0" aria-hidden />
            )}
            <span className="truncate">{open ? openLabel : label}</span>
          </button>
        ) : null}
        {children}
      </div>
    </div>
  );
}
