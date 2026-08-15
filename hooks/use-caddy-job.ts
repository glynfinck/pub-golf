"use client";

import { useRef, useState } from "react";

import { collectCaddyCard } from "@/lib/actions/caddy";
import {
  endingOf,
  lostThreadEnding,
  openResult,
  LOST_BALL,
  type JobEnding,
} from "@/lib/caddy/ending";
import type { CaddyMenu } from "@/lib/caddy/menu";
import type { PlannedCourse } from "@/lib/caddy/plan";
import { jobWorking, type JobStage } from "@/lib/caddy/stages";
import { thinkingTail, type CaddyOffer } from "@/lib/caddy/stream";
import { openPatch, streamPlan } from "@/lib/caddy/transport";

/**
 * The caddy's job, owned by the room it runs in.
 *
 * **The bug this exists to kill.** The job used to live inside `CaddyGroup` —
 * its state, its transport, and the fullscreen gallery portal — while the
 * *parent* owned mounting. So the parent could destroy a running job, and did:
 * the Course Room renders `landed ? card : <CaddyGroup/>`, and a landing card
 * sets `landed`, which unmounted the very component holding the portal that
 * was mid-performance. Twenty seconds of narration ended by deleting their own
 * payoff, taking the session id, the menu and the brief with them. Six
 * independent reviews found it; it is the single reason this hook exists.
 *
 * A job now outlives every component that looks at it, because the room holds
 * it and the room does not unmount. `CaddyGroup` becomes a thing that *shows*
 * the job rather than a thing that *is* it.
 *
 * **It has verbs.** The old arrangement had none — the parent's only channel
 * was props, so there was no way to say "stop" or "start again". Every one of
 * these closes a reported defect:
 *
 *   `dress()` refuses while a stream is in flight, so a double tap cannot
 *     spend a second credit (the ledger charges a redesign; it does not
 *     refuse a duplicate).
 *   every terminal path runs `settle()`, including `failed`, which previously
 *     left an undismissable pill over a finished run.
 *   `abandon()` gives the stage rail something to call when the host steps
 *     back, instead of orphaning a live menu behind them.
 *   the transport's own abort and stall watchdog mean a hung plan ends in an
 *     apology rather than in a reload.
 *
 * **What it deliberately does not own:** the brief (that is `useBrief`'s), the
 * fee gate, and anything that renders. This is the job and nothing else.
 */

export interface CaddyJob {
  stage: JobStage;
  /** The overlay is open. Closing it never cancels — see `CaddyGallery`. */
  open: boolean;
  /** There is something to come back to: a menu to pick from, a failure to
   * read. Not the same as working — conflating the two froze the stage rail. */
  active: boolean;
  working: boolean;
  menu: CaddyMenu | null;
  picked: string[];
  doing: string;
  thinking: string;
  course: PlannedCourse | null;
  error: string | null;
  refusal: { text: string; offer: CaddyOffer } | null;
  /** The conversation, once one exists — what the ask box spends. */
  sessionId: string | null;
  /** Bumped per plan; the gallery seeds its dials off it. */
  nonce: number;
}

export interface CaddyJobHandle extends CaddyJob {
  openPlan: (
    brief: Record<string, unknown>,
  ) => Promise<{ error?: string; detail?: string } | undefined>;
  dress: (
    request: Record<string, unknown>,
  ) => Promise<{ error?: string; detail?: string } | undefined>;
  /** Put the card on the table, however it arrived. */
  setCourse: (course: PlannedCourse | null) => void;
  setSessionId: (id: string | null) => void;
  show: () => void;
  hide: () => void;
  /** Stop caring about this run: no menu, no pill, no overlay. What the stage
   * rail calls when the host steps back behind the caddy. */
  abandon: () => void;
  /** Raise a refusal the host walked into deliberately — the spent panel's
   * door into the top-up shelf. The only other way one appears is a server
   * answer, which is the covenant: money answers a refusal, never speaks first. */
  showRefusal: (refusal: { text: string; offer: CaddyOffer }) => void;
  dismissRefusal: () => void;
}

export function useCaddyJob({
  onCourse,
  onPatch,
  onPicked,
  onTurn,
  onSession,
  session = null,
}: {
  onCourse: (course: PlannedCourse, changed: number[]) => void | Promise<void>;
  onPatch?: (pins: { id: string; lat: number; lng: number }[]) => void;
  onPicked?: (ids: string[]) => void;
  onTurn?: (turnId: string | null) => void;
  onSession?: (sessionId: string | null) => void;
  session?: string | null;
}): CaddyJobHandle {
  const [stage, setStage] = useState<JobStage>("opening");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(false);
  const [menu, setMenu] = useState<CaddyMenu | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [doing, setDoing] = useState("");
  const [thinking, setThinking] = useState("");
  const [course, setCourse] = useState<PlannedCourse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{
    text: string;
    offer: CaddyOffer;
  } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(session);
  const [nonce, setNonce] = useState(0);

  /** The session the open step created, spent by the dress step. A ref: the
   * stream closure needs it without racing a state update. */
  const menuSession = useRef<string | null>(null);
  /**
   * A request is on the wire.
   *
   * A ref rather than state, and that is the whole point: `dress()` has to
   * read it in the same tick the button was tapped, and a state flag updated
   * in the previous render is exactly what let a double tap through.
   */
  const inFlight = useRef(false);
  const abort = useRef<AbortController | null>(null);

  function advance(next: JobStage) {
    setStage(next);
    // Working and having-something-to-say are different facts. `active` keeps
    // the pill alive at `menu` and `failed`; only `working` may close a road.
    if (!jobWorking(next) && next !== "menu" && next !== "failed") {
      setActive(false);
    }
  }

  /** The run is over. Every ending comes through here — including a refusal,
   * which used to end by closing the overlay and leaving the stage behind. */
  function settle(next: JobStage) {
    inFlight.current = false;
    abort.current = null;
    advance(next);
  }

  /**
   * Put an ending on the screen.
   *
   * The counterpart to `lib/caddy/ending.ts` deciding *which* ending: this is
   * the only thing left that is not pure, and it is four setters. Every exit
   * from both requests goes through it, which is what makes "every ending is
   * an ending" true rather than aspirational.
   */
  function land(ending: JobEnding) {
    if (ending.refusal) setRefusal(ending.refusal);
    if (ending.closeOverlay) setOpen(false);
    setError(ending.error);
    settle(ending.stage);
  }

  /**
   * Ask before apologising.
   *
   * The card is written to `caddy_turns` before a byte of it is streamed, so a
   * plan whose connection dies on the way back has still produced one. It is
   * in Postgres, already paid for, while the host reads a timeout — which
   * happened for real: a 32.21p plan filed nine holes and the browser showed
   * an error.
   */
  async function rescue(
    fallback: string,
    detail?: string,
  ): Promise<{ error?: string; detail?: string }> {
    try {
      const rescued = await collectCaddyCard();
      if (!rescued.course) return { error: fallback, detail };
      if (rescued.sessionId) {
        setSessionId(rescued.sessionId);
        onSession?.(rescued.sessionId);
      }
      setCourse(rescued.course);
      await onCourse(rescued.course, []);
      settle("done");
      return {};
    } catch {
      return { error: fallback, detail };
    }
  }

  async function openPlan(brief: Record<string, unknown>) {
    if (inFlight.current) return;
    inFlight.current = true;
    abort.current = new AbortController();

    setThinking("");
    setDoing("");
    setPicked([]);
    setMenu(null);
    setCourse(null);
    setError(null);
    setNonce((current) => current + 1);
    setActive(true);
    setOpen(true);
    advance("opening");

    const answer = await openPatch(brief, { signal: abort.current.signal });
    const result = openResult(answer);
    if (result.kind === "ending") {
      land(result.ending);
      return {};
    }

    menuSession.current = result.sessionId;
    setMenu(result.menu);
    onPatch?.(
      result.menu.nodes.map((node) => ({
        id: node.id,
        lat: node.lat,
        lng: node.lng,
      })),
    );
    settle("menu");
    return {};
  }

  async function dress(request: Record<string, unknown>) {
    // The guard that stops a second credit being spent. Not a disabled prop —
    // this is the one that holds when two taps land in the same frame.
    if (inFlight.current) return;
    if (!menuSession.current) {
      land(lostThreadEnding());
      return;
    }
    inFlight.current = true;
    abort.current = new AbortController();

    setThinking("");
    setDoing("");
    setPicked([]);
    setError(null);
    setActive(true);
    advance("dressing");

    let carded = false;

    const outcome = await streamPlan(
      { ...request, sessionId: menuSession.current },
      async (event) => {
        if (event.type === "doing") {
          setDoing(event.text);
        } else if (event.type === "thinking") {
          setThinking((current) => thinkingTail(current + event.text));
        } else if (event.type === "patch") {
          onPatch?.(event.pins);
        } else if (event.type === "picked") {
          setPicked((current) => [...current, ...event.ids]);
          onPicked?.(event.ids);
        } else if (event.type === "card") {
          carded = true;
          setSessionId(event.sessionId);
          onSession?.(event.sessionId);
          onTurn?.(event.turnId ?? null);
          setCourse(event.course);
          await onCourse(event.course, []);
        }
      },
      { signal: abort.current.signal },
    );

    const ending = endingOf(outcome, carded);
    if (!ending.rescue) {
      land(ending);
      return {};
    }
    // The one ending that asks a question before it commits: the card may be
    // in Postgres already. `rescue` lands its own `done` when it finds one.
    const rescued = await rescue(ending.error ?? LOST_BALL, ending.detail);
    if (rescued.error) land({ ...ending, error: rescued.error, rescue: false });
    return rescued;
  }

  function abandon() {
    abort.current?.abort();
    inFlight.current = false;
    abort.current = null;
    menuSession.current = null;
    setMenu(null);
    setPicked([]);
    setDoing("");
    setThinking("");
    setError(null);
    setActive(false);
    setOpen(false);
    setStage("opening");
  }

  return {
    stage,
    open,
    active,
    // Derived from the stage, never from the in-flight ref: a ref read during
    // render neither re-renders nor is pure, and the stage is already exactly
    // `opening`/`dressing` for the life of a request.
    working: jobWorking(stage),
    menu,
    picked,
    doing,
    thinking,
    course,
    error,
    refusal,
    sessionId,
    nonce,
    openPlan,
    dress,
    setCourse,
    setSessionId: (id) => {
      setSessionId(id);
      onSession?.(id);
    },
    show: () => setOpen(true),
    hide: () => setOpen(false),
    abandon,
    showRefusal: setRefusal,
    dismissRefusal: () => setRefusal(null),
  };
}
