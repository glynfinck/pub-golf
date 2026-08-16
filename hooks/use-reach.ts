"use client";

import { useEffect, useState } from "react";

import { previewOf, type PatchPreview } from "@/lib/caddy/preflight";
import { centreOf, reachOf, type Reach } from "@/lib/caddy/reach";
import { searchPubs } from "@/lib/pub-search";
import type { Tables } from "@/types/database";

/**
 * Where the caddy is about to look, resolved as the host types.
 *
 * Two fixes over the effect this replaces, and both are about asking Google
 * less and telling the host more.
 *
 * **Keyed on the patch alone.** The old effect depended on `holes` as well, so
 * tapping 6 → 9 → 12 → 18 fired four Places searches for a number that only
 * ever changed the *radius* — pure arithmetic over a centre already in hand.
 * The lookup keys on `where`; the ring is derived in render.
 *
 * **Through `searchPubs`.** `lib/pub-search.ts` is documented as the one way
 * the browser asks for pubs, and this was one of two call sites that
 * hand-rolled the fetch and threw away `degraded` and `error` — so a search
 * that was refused looked exactly like a patch with no pubs in it. The error
 * is carried out now, for the caller to say out loud.
 *
 * A ring is an aid, never a gate: a search that will not answer costs the host
 * nothing but the drawing.
 */
export function useReach(
  where: string,
  holes: number,
  /** Told whenever the patch or the hole count moves the ring. Must be
   * stable — a `useState` setter is. */
  onReach?: (reach: (Reach & { preview?: PatchPreview }) | null) => void,
) {
  const [answered, setAnswered] = useState<{
    /** The patch this answer is *for*. Carried so a result can be told from
     * the one before it without an effect clearing state between them. */
    query: string;
    centre: { lat: number; lng: number } | null;
    results: Tables<"venues">[];
    error: string | null;
  } | null>(null);

  /**
   * The answer, but only where it belongs to what is typed now.
   *
   * This used to be an effect that cleared the state whenever the box went
   * empty — a setState in an effect body, which the house forbids and the
   * linter never saw because `hooks/` was outside the lint script. Deriving it
   * also fixes what the clear could not: typing over one patch with another
   * left the *first* patch's ring on the map for the 600ms of debounce, since
   * only an empty box reset anything.
   */
  const wanted = where.trim();
  const found = answered && answered.query === wanted ? answered : null;

  useEffect(() => {
    if (!where.trim()) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const answer = await searchPubs({ query: where });
        if (cancelled) return;
        setAnswered({
          query: where.trim(),
          centre: centreOf(answer.results),
          results: answer.results,
          error: answer.error ?? null,
        });
      } catch {
        if (!cancelled) setAnswered(null);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [where]);

  // Derived, not fetched: the radius is `holes` times a pace, and the preview
  // is the same results that placed the ring.
  const base = reachOf(found?.centre ?? null, null, holes);
  const reach: (Reach & { preview?: PatchPreview }) | null = base
    ? { ...base, preview: previewOf(found?.results ?? []) }
    : null;

  // Rebuilt from the two things that actually moved rather than from the
  // derived object above, which is a new reference every render and would
  // fire this on every keystroke.
  useEffect(() => {
    if (!onReach) return;
    const ring = reachOf(found?.centre ?? null, null, holes);
    onReach(
      ring ? { ...ring, preview: previewOf(found?.results ?? []) } : null,
    );
  }, [found, holes, onReach]);

  return { reach, searchError: found?.error ?? null };
}
