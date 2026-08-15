"use client";

import { useMemo, useReducer } from "react";

import { dialsReducer, DIALS_START } from "@/lib/caddy/dials";
import { rerouteMenu, type CaddyMenu, type MenuRoute } from "@/lib/caddy/menu";

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
 * **The transitions are not here.** They are `lib/caddy/dials.ts`, because
 * "re-routing forgets the hand-edit and the open card" is a rule six separate
 * mutators used to keep by convention — and the whole rule is provable by a
 * function call, so a hook is the wrong place to keep it. What is left here is
 * the routing the reducer must not do: `rerouteMenu` needs the menu, and the
 * menu is React's to hold.
 *
 * Everything here is arithmetic over the lean nodes the browser already has —
 * the same reason re-dialling costs nothing. Only *Dress this walk* spends.
 */
export function useMenuDials(menu: CaddyMenu | null) {
  const [dials, dispatch] = useReducer(dialsReducer, DIALS_START);

  const routes: MenuRoute[] = useMemo(() => {
    if (!menu) return [];
    return rerouteMenu(menu, { holes: dials.holes, stretch: dials.stretch });
  }, [menu, dials.holes, dials.stretch]);

  const route =
    routes[Math.min(dials.routeIndex, Math.max(routes.length - 1, 0))] ?? null;
  const stops = dials.edited ?? route?.stops ?? [];

  return {
    holes: dials.holes,
    stretch: dials.stretch,
    routeIndex: dials.routeIndex,
    routes,
    route,
    stops,
    edited: dials.edited,
    tapped: dials.tapped,
    swapping: dials.swapping,
    setSwapping: (open: boolean) => dispatch({ type: "swapping", open }),
    setTapped: (index: number | null) => dispatch({ type: "tap", index }),
    /** Seed from a freshly delivered menu — an event, never an effect. */
    seed: (from: { holes: number; stretch: number }) =>
      dispatch({ type: "seed", ...from }),
    pickRoute: (index: number) => dispatch({ type: "route", index }),
    setDialHoles: (value: number) => dispatch({ type: "holes", value }),
    setDialStretch: (value: number) => dispatch({ type: "stretch", value }),
    swapStop: (index: number, id: string) =>
      dispatch({ type: "swap", index, id, stops }),
    moveStop: (index: number, delta: number) =>
      dispatch({ type: "move", index, delta, stops }),
    restore: () => dispatch({ type: "restore" }),
  };
}

export type MenuDials = ReturnType<typeof useMenuDials>;
