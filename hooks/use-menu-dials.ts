"use client";

import { useMemo, useState } from "react";

import { rerouteMenu, type CaddyMenu, type MenuRoute } from "@/lib/caddy/menu";
import { withMove, withSwap } from "@/lib/caddy/swap";

/**
 * The host's own hand on the menu: which walk, how many holes, how far apart,
 * and any stop they have swapped or moved.
 *
 * **It lives above the overlay, not inside it.** This state used to sit in the
 * gallery's body, which unmounts whenever the overlay is closed — so glancing
 * at the map behind the gallery silently threw away a walk the host had spent
 * five taps editing. The body still remounts per plan; what re-seeds it is now
 * an explicit `seed()` called from the event that delivers a menu, rather than
 * a `key` on a component that also happened to unmount for other reasons.
 * Seeding in an event handler is not an effect, so the purity rule holds.
 *
 * Everything here is arithmetic over the lean nodes the browser already has —
 * the same reason re-dialling costs nothing. Only *Dress this walk* spends.
 */
export function useMenuDials(menu: CaddyMenu | null) {
  const [holes, setHoles] = useState(9);
  const [stretch, setStretch] = useState(5);
  const [routeIndex, setRouteIndex] = useState(0);
  /** The host's version of the chosen walk, once they have changed one. Null
   * means "the caddy's, as offered". */
  const [edited, setEdited] = useState<string[] | null>(null);
  /** Which stop's card is open, by position in the walk. */
  const [tapped, setTapped] = useState<number | null>(null);
  const [swapping, setSwapping] = useState(false);

  const routes: MenuRoute[] = useMemo(() => {
    if (!menu) return [];
    return rerouteMenu(menu, { holes, stretch });
  }, [menu, holes, stretch]);

  const route =
    routes[Math.min(routeIndex, Math.max(routes.length - 1, 0))] ?? null;
  const stops = edited ?? route?.stops ?? [];

  /**
   * Forget the hand-edit and the open card.
   *
   * Every control that re-routes calls this, and all of them used to forget
   * only *some* of it: the dials cleared `edited` and `routeIndex` but left
   * `tapped` pointing at a position in a walk that no longer existed. On a
   * shorter walk the card then described the wrong pub, "Swap" offered
   * "nothing else round here" over a full menu, and "Later" faked an edit by
   * moving a stop the host had never tapped.
   */
  function reset() {
    setEdited(null);
    setTapped(null);
    setSwapping(false);
  }

  return {
    holes,
    stretch,
    routeIndex,
    routes,
    route,
    stops,
    edited,
    tapped,
    swapping,
    setSwapping,
    setTapped,
    /** Seed from a freshly delivered menu — an event, never an effect. */
    seed(from: { holes: number; stretch: number }) {
      setHoles(from.holes);
      setStretch(from.stretch);
      setRouteIndex(0);
      reset();
    },
    pickRoute(index: number) {
      setRouteIndex(index);
      reset();
    },
    setDialHoles(next: number) {
      setHoles(next);
      setRouteIndex(0);
      reset();
    },
    setDialStretch(next: number) {
      setStretch(next);
      setRouteIndex(0);
      reset();
    },
    swapStop(index: number, id: string) {
      setEdited(withSwap(stops, index, id));
      setTapped(index);
      setSwapping(false);
    },
    moveStop(index: number, delta: number) {
      const next = withMove(stops, index, delta);
      // A refused move returns the same array. Re-pointing the card at
      // `index + delta` anyway is how "Later" on the last stop came to open a
      // different pub's card and look like an edit that never happened.
      if (next === stops) return;
      setEdited(next);
      setTapped(Math.min(Math.max(index + delta, 0), next.length - 1));
      setSwapping(false);
    },
    restore: reset,
  };
}

export type MenuDials = ReturnType<typeof useMenuDials>;
