"use client";

import { useState, useSyncExternalStore } from "react";

import {
  briefSentence,
  DEFAULT_HOLES,
  DEFAULT_MEASURES,
  DEFAULT_STRETCH,
  DEFAULT_TEE_OFF_MINUTES,
  type MeasureId,
  type ParticularId,
  type VibeId,
} from "@/lib/caddy/brief";
import { dayOptions } from "@/lib/caddy/tee-off";
import { strokeLengthKm, type StrokePoint } from "@/lib/caddy/stroke";

/**
 * What the host is asking for, and nothing else.
 *
 * Ten fields that used to sit in a 1500-line component beside a network
 * stream, a fee gate and a fullscreen portal — so "change the brief" and
 * "change how a plan is fetched" were edits to the same file for no reason
 * other than history. This is the brief's own reason to change, on its own.
 *
 * `briefBody()` is the one place the wire shape is assembled, so the open step
 * and anything else that plans can never disagree about what was asked.
 */

/**
 * Today's weekday, read through the house's hydration guard.
 *
 * `useSyncExternalStore` rather than a mounted-flag effect (CLAUDE.md), and a
 * subscription that never fires because the day does not change under a form
 * being filled in. The server snapshot is null, which is also what "no day
 * named" means downstream — every opening-hours check switches off rather
 * than guessing at a weekday the browser has not confirmed.
 */
const noClock = () => () => {};
const readToday = () => new Date().getDay();

export function useBrief({ stroke }: { stroke: StrokePoint[] | null }) {
  const [where, setWhere] = useState("");
  const [holes, setHoles] = useState<number>(DEFAULT_HOLES);
  const [vibe, setVibe] = useState<VibeId>("traditional");
  const [particulars, setParticulars] = useState<ParticularId[]>([]);
  const [measures, setMeasures] = useState<MeasureId[]>(DEFAULT_MEASURES);
  const [note, setNote] = useState("");
  const [stretch, setStretch] = useState<number>(DEFAULT_STRETCH);
  const today = useSyncExternalStore(noClock, readToday, () => null);
  const [ownDay, setDay] = useState<number | null>(null);
  const [teeOffMinutes, setTeeOffMinutes] = useState<number>(
    DEFAULT_TEE_OFF_MINUTES,
  );

  const teeDay = ownDay ?? today;

  /** The brief, as the wire reads it. One assembly, so nothing that plans can
   * disagree about what was asked. */
  function briefBody(): Record<string, unknown> {
    return {
      where,
      // Kept on the wire, never asked for: a drawn walk says where the night
      // finishes, and a typed patch is one patch.
      whereTo: "",
      /**
       * Always zero from here.
       *
       * `reachOf` answers `{ km: 1.2 }` for a single patch — the ring's
       * *radius*, not a distance to walk — and `targetKmFor` short-circuits on
       * any `reachKm > 0`, so sending it routed every round at a 1.38km target
       * whatever the spacing dial said. With no destination to name, the only
       * honest reach is a drawn walk's own arc length, and `readBrief`
       * measures that server-side from the stroke.
       */
      reachKm: 0,
      holes,
      vibe,
      particulars,
      measures,
      note,
      stretch,
      startVenueId: null,
      finishVenueId: null,
      stroke,
      // The weekday the host picked, already resolved against the browser's
      // own calendar — the brief stays pure by carrying the answer rather
      // than the question. Null until hydration, which is the honest reading
      // of "no day named" and switches the hours checks off.
      teeOffDay: teeDay,
      teeOffMinutes,
    };
  }

  return {
    where,
    setWhere,
    holes,
    setHoles,
    vibe,
    setVibe,
    particulars,
    setParticulars,
    measures,
    setMeasures,
    note,
    setNote,
    stretch,
    setStretch,
    today,
    teeDay,
    setDay,
    days: dayOptions(today),
    teeOffMinutes,
    setTeeOffMinutes,
    /** Whether there is anything to aim at yet. */
    aimed: Boolean(where.trim() || stroke),
    sentence: briefSentence({
      where,
      holes,
      vibe,
      stretch,
      strokeKm: stroke ? strokeLengthKm(stroke) : null,
    }),
    briefBody,
  };
}

export type Brief = ReturnType<typeof useBrief>;
