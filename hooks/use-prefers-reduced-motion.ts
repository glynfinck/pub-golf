"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether this player has asked their device to stop moving things about.
 *
 * `useSyncExternalStore` rather than a mounted effect, which is the house rule
 * for anything the server cannot see: the server has no media queries, so it
 * answers `false`, React hydrates against that answer and then swaps to the
 * real one on the client without the render ever having lied.
 *
 * `false` is the honest server answer as well as the convenient one — it is
 * what every browser without the setting reports, so the default is "animate"
 * and the preference is the opt-out, exactly as the media query intends.
 */
function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const list = window.matchMedia(QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

function snapshot() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

function serverSnapshot() {
  return false;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
