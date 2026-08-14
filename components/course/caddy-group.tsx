"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Sparkle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { FieldLabel, Input } from "@/components/ui/input";
import { CaddyUsage } from "@/components/course/caddy-usage";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PendingLabel } from "@/components/ui/pending-label";
import { Putt } from "@/components/ui/putt";
import { useAction } from "@/hooks/use-action";
import { useCountdown } from "@/hooks/use-countdown";
import {
  DEFAULT_HOLES,
  DEFAULT_STRETCH,
  DEFAULT_TEE_OFF_MINUTES,
  HOLE_CHOICES,
  NOTE_MAX,
  PARTICULARS,
  STRETCH_CHOICES,
  TEE_OFF_CHOICES,
  VIBES,
  WHERE_MAX,
  stretchMeaning,
  type ParticularId,
  type VibeId,
} from "@/lib/caddy/brief";
import {
  askTheCaddy,
  collectCaddyCard,
  reopenCaddyPatch,
} from "@/lib/actions/caddy";
import { CaddyMoreSheet } from "@/components/course/caddy-more-sheet";
import { GreenFeeSheet } from "@/components/round/green-fee-sheet";
import {
  CADDY_CREDITS_SPENT,
  feeIsSpent,
  freshCourseNotice,
} from "@/lib/caddy/credits";
import {
  decodeEvents,
  thinkingTail,
  type CaddyEvent,
  type CaddyOffer,
} from "@/lib/caddy/stream";
import { centreOf, reachOf, type Reach } from "@/lib/caddy/reach";
import { previewOf, thinPatchNote } from "@/lib/caddy/preflight";
import {
  CaddyGallery,
  type DressChoice,
  type GalleryStage,
} from "@/components/course/caddy-gallery";
import type { CaddyMenu } from "@/lib/caddy/menu";
import { DrawWalkSheet } from "@/components/course/draw-walk-sheet";
import { strokeLengthKm, type StrokePoint } from "@/lib/caddy/stroke";
import { MAPS_BROWSER_KEY } from "@/lib/maps";
import type { PlannedCourse } from "@/lib/caddy/plan";
import { formatTimeLeft } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * The caddy, as one members' group on the drafting table.
 *
 * There is no separate planner and no second route: the builder opens exactly
 * as it always has, and this sits above the free search. Unbought, unkeyed or
 * billing off, the whole group is absent and the builder is the one that ships
 * — which is the covenant's "what's free stays free", expressed as layout
 * rather than as a promise.
 *
 * The group owns the brief, the wait and the caddy's own two verbs. The card
 * it produces belongs to the builder, because a caddy-planned course is a
 * draft on the same table as a hand-plotted one and every edit is the same.
 */
export function CaddyGroup({
  hasPass,
  onCourse,
  onPatch,
  onPicked,
  onTurn,
  allowance,
  onSession,
  onReach,
  reach,
  onStage,
  room = false,
  strokeOverride,
  session = null,
  reopen = null,
  passExpiresAt = null,
  filed = false,
  className,
}: {
  /** A live green fee on this host. The form is identical either way — only
   * its last row changes, because the ask belongs after the investment. */
  hasPass: boolean;
  /** A card arrived. The builder takes it from here. */
  onCourse: (course: PlannedCourse, changed: number[]) => void | Promise<void>;
  /** The patch, the moment Places answers — several seconds before any hole
   * exists. The drafting table frames its map on it. */
  onPatch?: (pins: { id: string; lat: number; lng: number }[]) => void;
  /** Pubs as the caddy names them, in its own order rather than the walking
   * order, which is not decided until the card is complete. */
  onPicked?: (ids: string[]) => void;
  /** Whether this fee still has a course to give. Absent means yes — a
   * database that has not caught up says yes, exactly as the pipeline does. */
  allowance?: { canPlan: boolean; left: number; courseId: string | null };
  /** The session behind the card, so the builder can close it on save. */
  onSession: (sessionId: string | null) => void;
  /** The turn behind *this* card, so a report can name the card rather than
   * the conversation. Null on a resumed session until the caddy is asked
   * something: the id belongs to a turn this page watched happen. */
  onTurn?: (turnId: string | null) => void;
  /**
   * A conversation the server found already open, if there is one.
   *
   * The missing half of resuming. The drafting table restored the card and
   * remembered the session id, but this group — the only thing that renders an
   * ask box — kept its own `sessionId` and started it at null, so a resumed
   * host was shown the *plan* form for a patch that was already planned. The
   * thread was in the database, on the page, and in the parent's state, and
   * still could not be spoken to.
   */
  session?: string | null;
  /**
   * A conversation whose patch has been swept, and the id it lives under.
   *
   * The retention rule's bill, made payable. Twelve hours after a session
   * opens its dossier goes, and a host with tweaks left on their fee had no
   * way to spend them but to plan the course again — which costs a re-design
   * for work already done. One trip back to Google puts the patch back.
   */
  reopen?: string | null;
  /** When the green fee's day runs out, so the confirmation can say. Null when
   * there is no pass — the form below already says what one costs. */
  passExpiresAt?: string | null;
  /** Whether this fee has already filed a course. A fresh plan writes over it,
   * and doing that silently would throw away an evening's work without asking. */
  filed?: boolean;
  /** How far the round reaches, for the ring on the drafting table's map.
   * Null while there is nothing to draw. */
  onReach?: (reach: Reach | null) => void;
  /** The reach as the builder currently holds it, so the warning under the
   * form and the ring on the map are read from one value. */
  reach?: Reach | null;
  /** The job's stage, as a label the minimap wears — null when no plan is
   * live. One of the three windows on the job (gallery, pill, badge). */
  onStage?: (label: string | null) => void;
  /**
   * Rendered inside the Course Room rather than on the drafting table.
   *
   * Same group, same job, different furniture: the room owns the map — the
   * draw surface *is* the screen there — so the brief drops its card chrome,
   * its collapse and its own draw button, and keeps only the fields and the
   * plan. One implementation of the job, two rooms to stand it in.
   */
  room?: boolean;
  /** The room's own stroke, drawn on its map. Undefined leaves the group
   * owning one internally, which is what the drafting table does. */
  strokeOverride?: StrokePoint[] | null;
  className?: string;
}) {
  const router = useRouter();
  const { run, pending, busy } = useAction();
  const [open, setOpen] = useState(false);
  // Seeded from the server's answer, so a resumed conversation opens on the
  // ask box rather than on the form that would plan the patch again.
  const [sessionId, setSessionId] = useState<string | null>(session);
  const [ask, setAsk] = useState("");
  // The fresh-course confirmation. Held rather than fired from a `confirm()`
  // so it can carry the two facts a host actually needs — what it replaces and
  // how long the fee has left.
  const [confirming, setConfirming] = useState(false);
  /**
   * How long the fee has to run, as a live figure.
   *
   * `useCountdown` rather than a `Date.now()` in render — the house rule, and
   * the hydration guard that comes with it: it answers null until the first
   * client tick, and `formatTimeLeft` renders the fact without the figure
   * rather than a flash of the wrong one.
   */
  const passLeftMs = useCountdown(
    passExpiresAt ? Date.parse(passExpiresAt) : null,
  );
  // The caddy's own reasoning while it works, trimmed to a line. Narration
  // only: nothing reads it, and a run where it never arrives is a run that
  // looks exactly like the old one.
  const [thinking, setThinking] = useState("");
  // The tool the caddy is reaching for, named. Outranks the reasoning below.
  const [doing, setDoing] = useState("");
  /**
   * A refusal about money, and the door that answers it.
   *
   * Held rather than thrown at a toast, because a toast is the wrong shape for
   * this: it is gone in four seconds, it says nothing about what to do next,
   * and it reads as breakage. Neither of these is breakage — one host has
   * their courses in the book, the other has simply not paid yet — so each
   * gets a sheet with the way on.
   *
   * This is the only state in the group that may render a price, and it can
   * only be set by a refusal the host walked into. That is the covenant's
   * money rule with somewhere to live.
   */
  const [refusal, setRefusal] = useState<{ text: string; offer: CaddyOffer } | null>(null);
  // Read back inside the streaming closure, which cannot see a state update it
  // made a moment ago.
  const refusedRef = useRef(false);

  const [where, setWhere] = useState("");
  const [holes, setHoles] = useState<number>(DEFAULT_HOLES);
  const [vibe, setVibe] = useState<VibeId>("traditional");
  const [particulars, setParticulars] = useState<ParticularId[]>([]);
  const [note, setNote] = useState("");
  const [stretch, setStretch] = useState<number>(DEFAULT_STRETCH);
  /** The walk, drawn — the brief's last escalation. Null is most rounds.
   * In the room the map owns it and hands it down through `strokeOverride`. */
  const [ownStroke, setStroke] = useState<StrokePoint[] | null>(null);
  const stroke = strokeOverride !== undefined ? strokeOverride : ownStroke;
  const [drawOpen, setDrawOpen] = useState(false);
  /** When the round happens. The weekday is resolved in `briefBody`, inside
   * the submit handler — the one place this component may read a clock. */
  const [when, setWhen] = useState<"tonight" | "tomorrow">("tonight");
  const [teeOffMinutes, setTeeOffMinutes] = useState<number>(
    DEFAULT_TEE_OFF_MINUTES,
  );

  /**
   * The gallery: the fullscreen view the plan performs on.
   *
   * All of its state lives here rather than in the overlay, because the
   * overlay is optional viewing — closing it must change nothing about the
   * plan, so the plan can own none of its state.
   */
  const [gallery, setGallery] = useState(false);
  const [galleryStage, setGalleryStage] = useState<GalleryStage>("opening");
  const [menu, setMenu] = useState<CaddyMenu | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [galleryCourse, setGalleryCourse] = useState<PlannedCourse | null>(null);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  /** Bumped per plan so the gallery's body remounts and re-seeds its dials. */
  const [galleryNonce, setGalleryNonce] = useState(0);
  /** A plan is in flight or failed unseen — what keeps the pill honest. */
  const [jobActive, setJobActive] = useState(false);
  /** The session the open step created, spent by the dress step. A ref: the
   * stream closure needs it without racing a state update. */
  const menuSession = useRef<string | null>(null);

  /**
   * One door for every stage change, so the three things that mirror the job
   * — the gallery, the pill, and the minimap's badge — can never disagree
   * about where the plan is.
   */
  function advance(next: GalleryStage) {
    setGalleryStage(next);
    if (next === "done") setJobActive(false);
    onStage?.(
      next === "opening"
        ? "Walking the patch"
        : next === "menu"
          ? "Walks ready"
          : next === "dressing"
            ? "Dressing the card"
            : next === "failed"
              ? "The caddy lost the ball"
              : null,
    );
  }

  const meaning = VIBES.find((entry) => entry.id === vibe)?.meaning ?? "";
  // One patch, one pace: the spacing chips mean exactly what they say now
  // that nothing else sets the walk's length. A drawn walk overrides them
  // with its own arc length, server-side, where it can be measured.
  const stretchNote = stretchMeaning(stretch);

  /**
   * Where the caddy is about to look, resolved as the host types.
   *
   * The names are turned into coordinates by the same Places search the
   * builder already uses, which means no geocoding key, no new route and no
   * new failure mode — if search is degraded the ring simply does not appear
   * and everything else works exactly as before.
   *
   * Debounced, because this fires on a keystroke and "Sho" is not a place.
   * The cancelled flag matters more than the delay: a host typing quickly has
   * several of these in flight, and without it the ring lands on whichever
   * request happened to finish last rather than on what they actually typed.
   */
  useEffect(() => {
    if (!where.trim()) {
      onReach?.(null);
      return;
    }
    let cancelled = false;
    const lookup = async (query: string) => {
      if (!query.trim()) return null;
      try {
        const response = await fetch("/api/places/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        const body = (await response.json()) as {
          results?: {
            id: string;
            lat: number | null;
            lng: number | null;
            address: string | null;
          }[];
        };
        const results = body.results ?? [];
        return { centre: centreOf(results), results };
      } catch {
        // A ring is an aid, never a gate. A search that will not answer costs
        // the host nothing but the drawing.
        return null;
      }
    };
    const timer = setTimeout(async () => {
      const from = await lookup(where);
      if (cancelled) return;
      const reach = reachOf(from?.centre ?? null, null, holes);
      // The pre-flight rides on the reach: the same results that placed the
      // ring become the pins, the count and the echo, so the host sees what
      // the caddy is about to look at before anything is spent.
      onReach?.(
        reach ? { ...reach, preview: previewOf(from?.results ?? []) } : null,
      );
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [where, holes, onReach]);

  /**
   * The brief, as the wire reads it. One assembly, because the straight plan
   * and the open step must never disagree about what was asked.
   */
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
       * *radius*, not a distance to walk — and `targetKmFor` short-circuits
       * on any `reachKm > 0`, so sending it routed every round at a 1.38km
       * target whatever the spacing chips said. With no destination to name,
       * the only honest reach is a drawn walk's own arc length, and
       * `readBrief` measures that server-side from the stroke.
       */
      reachKm: 0,
      holes,
      vibe,
      particulars,
      note,
      stretch,
      startVenueId: null,
      finishVenueId: null,
      stroke,
      // Resolved here, in the handler, because "tonight" only means a weekday
      // next to a calendar — and the brief stays pure by carrying the answer
      // rather than the question.
      teeOffDay: (new Date().getDay() + (when === "tomorrow" ? 1 : 0)) % 7,
      teeOffMinutes,
    };
  }

  /**
   * The dress step, over a stream.
   *
   * A route rather than the action, because an action resolves once and the
   * interesting part of a plan is the twenty seconds before it does: the patch
   * lands early enough to frame a map on, and the caddy's own reasoning
   * arrives while it is still reasoning. The tweak below is still an action —
   * it answers in a couple of seconds and there is nothing to narrate.
   *
   * Everything the stream says is optional. A run where every middle event
   * went missing still ends in a card or an honest failure, which is what
   * makes it safe to treat the narration as decoration — and it is why the
   * gallery's X can close the view without touching the work.
   */
  function stream(request: Record<string, unknown>) {
    run(async () => {
      setThinking("");
      setDoing("");
      setPicked([]);
      advance("dressing");
      refusedRef.current = false;
      const lost = "The caddy lost the ball. Ask again — this one's free.";
      let failure: { error: string; detail?: string } | null = null;
      let landed = false;

      let response: Response;
      try {
        response = await fetch("/api/caddy/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
      } catch {
        advance("failed");
        setGalleryError(lost);
        return { error: lost };
      }

      // A refusal decided before the model was ever asked — no fee, a thin
      // patch, no sign-in — comes back as ordinary JSON rather than as a
      // stream that opens only to apologise.
      if (!response.body || !response.headers.get("content-type")?.includes("ndjson")) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string; offer?: CaddyOffer }
          | null;
        setGallery(false);
        if (body?.offer && body.error) {
          refusedRef.current = true;
          setRefusal({ text: body.error, offer: body.offer });
          return {};
        }
        return { error: body?.error ?? lost };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handle = async (event: CaddyEvent) => {
        if (event.type === "doing") {
          // A named tool call replaces the reasoning ticker rather than
          // joining it: "Looking for beer gardens" is the work the host is
          // paying for, and it should not be buried in a paragraph of prose.
          setDoing(event.text);
        } else if (event.type === "thinking") {
          setThinking((current) => thinkingTail(current + event.text));
        } else if (event.type === "patch") {
          onPatch?.(event.pins);
        } else if (event.type === "picked") {
          setPicked((current) => [...current, ...event.ids]);
          onPicked?.(event.ids);
        } else if (event.type === "card") {
          setSessionId(event.sessionId);
          onSession(event.sessionId);
          onTurn?.(event.turnId ?? null);
          await onCourse(event.course, []);
          setGalleryCourse(event.course);
          advance("done");
          landed = true;
        } else if (event.offer) {
          refusedRef.current = true;
          setGallery(false);
          setRefusal({ text: event.error, offer: event.offer });
        } else {
          failure = { error: event.error, detail: event.detail };
        }
      };

      try {
        for (;;) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const { events, rest } = decodeEvents(buffer);
          buffer = rest;
          for (const event of events) await handle(event);
          if (done) break;
        }
      } catch {
        // The connection went away mid-plan. If the card had already landed
        // that is a finished plan with a rough ending, not a failure.
        if (!landed) return await collect(lost);
      }

      // Cast rather than read straight through: `failure` is only ever
      // assigned inside the stream callback, so TypeScript's flow analysis
      // still believes it is null here and narrows the guard to `never`. The
      // old code got away with returning it because `never` is assignable to
      // anything; reading a property off it does not.
      const failed = failure as { error: string; detail?: string } | null;
      if (failed) {
        if (!landed) {
          const rescued = await collect(failed.error, failed.detail);
          if (!("error" in rescued) || !rescued.error) return rescued;
          advance("failed");
          setGalleryError(failed.error);
          return rescued;
        }
        return failed;
      }
      // A money refusal is a finished run, not a failed one — the sheet says so.
      if (landed || refusedRef.current) return {};
      const rescued = await collect(lost);
      if ("error" in rescued && rescued.error) {
        advance("failed");
        setGalleryError(lost);
      }
      return rescued;
    });
  }

  /**
   * The open step: gather the patch, get the menu, spend nothing.
   *
   * The gallery opens on the tap and the walks arrive a few seconds later.
   * Without a browser maps key there is nowhere to show a menu, so the plan
   * runs straight through exactly as it always did — the same graceful
   * absence the builder keeps for every map.
   */
  function openMenu() {
    if (!MAPS_BROWSER_KEY) {
      stream(briefBody());
      return;
    }
    run(async () => {
      setMenu(null);
      setPicked([]);
      setThinking("");
      setDoing("");
      setGalleryCourse(null);
      setGalleryError(null);
      advance("opening");
      setJobActive(true);
      setGalleryNonce((current) => current + 1);
      setGallery(true);
      const lost = "The caddy lost the ball. Ask again — this one's free.";
      type OpenAnswer = {
        sessionId?: string;
        menu?: CaddyMenu;
        error?: string;
        offer?: CaddyOffer;
      };
      let body: OpenAnswer | null = null;
      try {
        const response = await fetch("/api/caddy/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(briefBody()),
        });
        body = (await response.json().catch(() => null)) as OpenAnswer | null;
      } catch {
        body = null;
      }
      if (!body || body.error || !body.sessionId || !body.menu) {
        setGallery(false);
        if (body?.offer && body.error) {
          setRefusal({ text: body.error, offer: body.offer });
          return {};
        }
        return { error: body?.error ?? lost };
      }
      menuSession.current = body.sessionId;
      setMenu(body.menu);
      advance("menu");
      // The patch frames the drafting table's own map too, so leaving the
      // gallery lands on a view that already knows the neighbourhood.
      onPatch?.(
        body.menu.nodes.map((node) => ({ id: node.id, lat: node.lat, lng: node.lng })),
      );
      return {};
    });
  }

  /** The host chose — or declined to choose — and the turn that spends runs. */
  function dress(choice: DressChoice) {
    if (!menuSession.current) return;
    stream({
      sessionId: menuSession.current,
      route: choice.route,
      holes: choice.holes,
      stretch: choice.stretch,
    });
  }

  /**
   * Ask before apologising.
   *
   * The card is written to `caddy_turns` before a byte of it is streamed, so a
   * plan whose connection dies on the way back has still produced one. It is in
   * Postgres, already paid for, while the host reads a timeout — which happened
   * for real: a 32.21p plan filed nine holes and the browser showed an error.
   *
   * So every path that was about to return a failure checks first. If a card is
   * there it is put on the table and the run counts as finished; the host never
   * learns the stream broke, which is the correct amount to tell them about our
   * plumbing.
   */
  async function collect(
    error: string,
    detail?: string,
  ): Promise<{ error?: string; detail?: string }> {
    try {
      const rescued = await collectCaddyCard();
      if (!rescued.course) return { error, detail };
      if (rescued.sessionId) {
        setSessionId(rescued.sessionId);
        onSession(rescued.sessionId);
      }
      await onCourse(rescued.course, []);
      return {};
    } catch {
      // The rescue is best-effort by definition. If it cannot run, the host
      // gets the failure they were always going to get.
      return { error, detail };
    }
  }

  function say(input: { ask?: string; roll?: boolean }) {
    if (!sessionId) return;
    run(async () => {
      const result = await askTheCaddy({ sessionId, ...input });
      if (result.error) return { error: result.error, detail: result.detail };
      if (result.course) {
        onTurn?.(result.turnId ?? null);
        await onCourse(result.course, result.changed ?? []);
      }
      setAsk("");
      return {};
    });
  }

  /**
   * Before a fresh card: what it replaces, and how long the fee has to run.
   *
   * A sheet rather than a `confirm()` because there are two facts to carry and
   * a browser dialog can carry neither well. It is the only thing standing
   * between a host and writing over an evening's work — a fee files one course,
   * so planning again replaces the one in the book.
   */
  const freshSheet = (
    <Sheet open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
      <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-2xl">
        <SheetHeader className="pb-0 text-center">
          <SheetTitle className="eyebrow text-center text-fairway">
            The caddy
          </SheetTitle>
          <SheetDescription className="font-serif text-xl text-foreground not-italic">
            {filed ? "Plan a different course?" : "Ready when you are"}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4 pb-6">
          {freshCourseNotice({
            // No expiry on the row means the day has not started. That is the
            // ordinary case now, and the one worth saying out loud.
            dormant: passExpiresAt === null,
            timeLeft: formatTimeLeft(passLeftMs),
            replacing: filed,
            cardsLeftAfter: Math.max(0, (allowance?.left ?? 1) - 1),
          }).map((line) => (
            <p key={line} className="text-center text-xs text-muted-foreground">
              {line}
            </p>
          ))}
          <Button
            className="mt-1 w-full"
            onClick={() => {
              setConfirming(false);
              openMenu();
            }}
            data-testid="confirm-fresh-course"
          >
            {filed ? "Plan it anyway" : "Plan the round"}
          </Button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="min-h-11 text-xs font-semibold text-muted-foreground hover:text-fairway"
          >
            Not yet
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );

  /**
   * The green fee, offered because the host asked for a course and had not
   * paid for one.
   *
   * The house's existing sheet, not a second telling of it: one price, one
   * dot-leader menu, one plain exit. The whole of what makes this legitimate
   * under the covenant is *when* it opens — a host who never asks the caddy
   * for anything never sees a price on this page at all.
   */
  const feeSheet = (
    <GreenFeeSheet
      open={refusal?.offer === "fee"}
      onOpenChange={(open) => !open && setRefusal(null)}
    />
  );

  /**
   * The other door: a fee that has planned every course it bought.
   *
   * Rendered beside every face the group can wear rather than replacing one,
   * because the refusal can arrive from the brief screen *or* mid-plan and it
   * should look the same either way.
   */
  const moreSheet = (
    <CaddyMoreSheet
      open={refusal?.offer === "more"}
      onOpenChange={(open) => !open && setRefusal(null)}
      courseId={allowance?.courseId}
      standing={refusal?.text ?? ""}
    />
  );

  /**
   * The gallery overlay, rendered from every face the group can wear: the
   * plan crosses several of them (form → wait → ask box) and the overlay must
   * survive each transition. A portal, so it costs the layout nothing.
   */
  const galleryEl = (
    <CaddyGallery
      open={gallery}
      active={jobActive}
      onReopen={() => setGallery(true)}
      nonce={galleryNonce}
      state={{
        stage: galleryStage,
        menu,
        picked,
        doing,
        thinking,
        course: galleryCourse,
        error: galleryError,
      }}
      holes={holes}
      stretch={stretch}
      onDress={dress}
      onClose={() => setGallery(false)}
    />
  );

  // ——— The wait. Narrated, never spun: the line names the stage the
  // pipeline is actually in, and the Putt is the house's own busy animation.
  if (pending) {
    return (
      <div
        className={cn(
          "engraved flex flex-col items-center gap-3 rounded-xl bg-card px-4 py-6",
          className,
        )}
        aria-live="polite"
      >
        {galleryEl}
        <Putt />
        {/* Three fixed rows, and the heading never moves.
            It used to be replaced by whatever tool the caddy had reached for,
            which put "Looking for pubs with a beer garden near Old Street" in
            an 18px serif and pushed the panel out of shape. The heading is now
            the one stable thing on the screen and everything that varies sits
            under it, in its own row, clamped. */}
        <div className="text-center font-serif text-lg leading-tight text-balance">
          {sessionId ? "The caddy’s thinking" : "The caddy’s walking the patch"}
        </div>
        <div className="flex min-h-9 w-full flex-col items-center justify-start gap-1 overflow-hidden">
          {doing ? (
            <p className="animate-in fade-in line-clamp-1 max-w-full text-center text-[11px] font-semibold text-fairway">
              {doing}
            </p>
          ) : null}
          {/* What it is actually thinking, where there is any — the end of it,
              fading rather than jumping. Absent on a tweak and absent if the
              stream sends none, which is why the heading above still says
              something on its own. */}
          {thinking ? (
            <p
              aria-live="off"
              className="animate-in fade-in line-clamp-2 max-w-full text-center text-[11px] text-muted-foreground/80 italic"
            >
              {thinking}
            </p>
          ) : doing ? null : (
            <p className="text-[11px] text-muted-foreground">
              {sessionId ? "Won’t be a moment." : "About twenty seconds."}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ——— The card is here and the patch is not. Offered rather than done
  // automatically: it is a call out to Google, and a host who only came to
  // rename a hole should not pay for one they never asked for.
  if (!sessionId && reopen) {
    return (
      <div
        className={cn("engraved flex flex-col gap-2.5 rounded-xl bg-card px-4 py-3.5", className)}
      >
        <span className="eyebrow text-fairway">The caddy</span>
        <p className="text-[13px] text-muted-foreground">
          The caddy has put this patch away for the night. Fetch it back and
          you can carry on changing the card — it costs nothing off your fee.
        </p>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const result = await reopenCaddyPatch(reopen);
              if (result.error) return result;
              // The patch is on the session now; the page reads it on the way
              // back in, which is also what puts the ask box on screen.
              router.refresh();
              return {};
            })
          }
        >
          <PendingLabel
            pending={pending}
            busy={busy}
            label="Pick this back up"
            pendingLabel="Bringing it back"
          />
        </Button>
      </div>
    );
  }

  // ——— On the table: the caddy's two verbs, once a card exists. No count
  // anywhere — the caddy is not rationed on screen.
  if (sessionId) {
    return (
      <div
        className={cn("engraved flex flex-col gap-2.5 rounded-xl bg-card px-4 py-3.5", className)}
      >
        {galleryEl}
        {moreSheet}
        {feeSheet}
        <span className="eyebrow text-fairway">The caddy</span>
        <div>
          <FieldLabel htmlFor="caddy-ask">Tell the caddy</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              id="caddy-ask"
              value={ask}
              onChange={(event) => setAsk(event.target.value.slice(0, 200))}
              placeholder="More gardens in the back half"
            />
            <Button
              size="compact"
              variant="outline"
              className="h-12 shrink-0"
              disabled={!ask.trim() || busy}
              onClick={() => say({ ask: ask.trim() })}
            >
              Ask
            </Button>
          </div>
        </div>
        <Button
          variant="outline"
          size="compact"
          className="h-11 w-full"
          disabled={busy}
          onClick={() => say({ roll: true })}
        >
          Roll a fresh card
        </Button>
        <p className="text-[10px] text-muted-foreground">
          Ask as often as you like — it&apos;s the same patch, so the caddy is
          quick about it. Every pub is one that&apos;s really there; swap any of
          them below.
        </p>
      </div>
    );
  }

  // ——— Collapsed: one line on the menu, unpriced and entirely ignorable.
  //
  // It used to carry `Green fee · £12` here, which is a price nobody asked
  // for on a page a host opened to plot a course by hand. Money answers a
  // refusal; it does not greet you. What the card still says is that the
  // caddy is a members' thing and that everything under it is free — the
  // disclosure without the pitch.
  if (!open && !room) {
    return (
      <div
        className={cn("engraved flex flex-col gap-2 rounded-xl bg-card px-4 py-3.5", className)}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow text-fairway">Members</span>
          {/* What is left, not merely that something was bought. `Covered`
              alone went on saying Covered after the last go had been spent —
              which is the app telling somebody they have something they do
              not, right up to the moment it refuses them. `CaddyUsage` exists
              for exactly this and had only ever been wired into the brief. */}
          {hasPass ? (
            allowance ? <CaddyUsage left={allowance.left} /> : <CoveredBadge />
          ) : null}
        </div>
        <div className="font-serif text-base leading-tight">
          Let the caddy plan it
        </div>
        <p className="text-[11px] text-muted-foreground">
          A routed course from any patch of town — pubs, pars, drinks and
          hazards, ready in about twenty seconds. Everything below stays free.
        </p>
        <Button
          variant="outline"
          size="compact"
          className="mt-1 h-11 w-full"
          onClick={() => setOpen(true)}
          data-testid="open-caddy"
        >
          <Sparkle aria-hidden /> Plan the round
        </Button>
      </div>
    );
  }

  // ——— The fee has its course. Not a wall and not a price: a door to the
  // thing they already own, and the two free ways on. The drafting table below
  // is untouched — the manual builder never cost anything and still does not,
  // which is the sentence this panel exists to make sure nobody misses.
  //
  // Through `feeIsSpent`, because the condition here used to be the allowance
  // alone — and an empty allowance is what a spent fee and a fee nobody ever
  // bought both look like. That put this panel, its "this green fee has
  // planned all its courses" and its door to the top-up shelf in front of
  // hosts who had never paid for anything. See `feeIsSpent` for the whole of
  // it; with no pass the group falls through to the brief, where asking for a
  // course is answered with the green fee.
  if (allowance && feeIsSpent({ hasPass, canPlan: allowance.canPlan }) && !sessionId) {
    return (
      <div
        className={cn("engraved flex flex-col gap-2 rounded-xl bg-card px-4 py-3.5", className)}
        data-testid="caddy-spent"
      >
        {moreSheet}
        {feeSheet}
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow text-fairway">The caddy</span>
          <CaddyUsage left={0} />
        </div>
        {/* This said "the caddy plans three to a green fee" — a number that
            was `caddy_courses_per_fee()` before the ledger dropped it, sitting
            two lines under a row of five pips. The sentence that owns the
            allowance is written beside the allowance now, and there is only
            one of it. */}
        <p className="text-xs text-muted-foreground">{CADDY_CREDITS_SPENT}</p>
        {allowance.courseId ? (
          <Link
            href={`/courses/${allowance.courseId}`}
            className={cn(buttonVariants({ variant: "outline", size: "compact" }), "h-10 w-full")}
          >
            Open your course
          </Link>
        ) : null}
        {/* The door that was missing. A host who spent their fee, closed the
            tab and came back met this panel — which mounted the sheet and
            never opened it, so the top-ups were reachable only by someone
            whose allowance read as available and was then refused. The sheet
            still only opens because they asked. */}
        <button
          type="button"
          onClick={() => setRefusal({ text: CADDY_CREDITS_SPENT, offer: "more" })}
          className="min-h-11 text-[11px] font-semibold text-muted-foreground hover:text-fairway"
        >
          Have the caddy plan more
        </button>
        <p className="text-[10px] text-muted-foreground">
          Plotting one by hand below is free, as always.
        </p>
      </div>
    );
  }

  // ——— The brief. One screen, defaults everywhere a default is honest.
  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        room
          ? "px-4 pt-2 pb-4"
          : "engraved rounded-xl bg-card px-4 py-3.5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow text-fairway">
          {room ? "The brief" : "Let the caddy plan it"}
        </span>
        {/* "Covered" was the whole of what a host could see, and it went on
            saying Covered after the last course had been planned. A pass has
            two dimensions and this badge only ever showed one — so once there
            is a fee, what it says is what is left on it. With no fee it says
            nothing at all: the price belongs to the refusal, not to the form. */}
        {hasPass ? (
          allowance ? <CaddyUsage left={allowance.left} /> : <CoveredBadge />
        ) : null}
      </div>
      {room ? null : (
        <div className="font-serif text-lg leading-tight text-balance">
          Your round, planned in twenty seconds
        </div>
      )}
      {galleryEl}
      {moreSheet}
      {feeSheet}

      {/* The pen comes first: reposition, lock, draw. Drawing the walk is
          the most concrete brief there is — the density field shows where a
          night can live, the stroke is the axis, and the swath is the
          gather. The typed patch below stays for the host who would rather
          name a place than draw one. */}
      {MAPS_BROWSER_KEY && !room ? (
        <div>
          {stroke ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-fairway">
                Walk drawn — {strokeLengthKm(stroke).toFixed(1)} km
              </span>
              <Chip onClick={() => setDrawOpen(true)}>Redraw</Chip>
              <Chip onClick={() => setStroke(null)}>Clear</Chip>
            </div>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setDrawOpen(true)}
                data-testid="open-draw-walk"
              >
                Draw the walk on the map
              </Button>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Reposition, hold still, draw — the map shows where the pubs
                are thick before you commit.
              </p>
            </>
          )}
        </div>
      ) : null}

      <div>
        <FieldLabel htmlFor="caddy-where">
          {MAPS_BROWSER_KEY ? "Or name a patch" : "Where"}
        </FieldLabel>
        <Input
          id="caddy-where"
          value={where}
          onChange={(event) => setWhere(event.target.value.slice(0, WHERE_MAX))}
          placeholder="Shoreditch, London"
        />
        <p className="mt-1 text-[10px] text-muted-foreground">
          A neighbourhood, a street, a town.
        </p>
      </div>

      {/* **The destination field is gone.**
          It asked the host to name where the night finishes — which the walk
          they drew has already said, twice over: `gatherPubs` takes the
          stroke's own ends as the corridor's, and `readBrief` measures its
          arc length for the reach. Asking again was asking for something
          already answered, and it brought a whole second pace control with
          it. A typed patch is one patch now, paced by the spacing chips; a
          drawn walk is paced by its own length. `whereTo` stays on the wire
          and in `readBrief` so sessions written before this still read. */}

      <div>
        <FieldLabel htmlFor="caddy-holes">Holes</FieldLabel>
        <div className="flex flex-wrap gap-1.5" id="caddy-holes" role="radiogroup" aria-label="Holes">
          {HOLE_CHOICES.map((count) => (
            <Chip
              key={count}
              role="radio"
              aria-checked={holes === count}
              active={holes === count}
              onClick={() => setHoles(count)}
            >
              {count}
            </Chip>
          ))}
        </div>
        {/* The counter-offer, before the button rather than after the fee:
            the count is the lean search's floor, so this warns and names the
            hole count that fits — it never gates. The server still decides. */}
        {reach?.preview ? (
          (() => {
            const thin = thinPatchNote(reach.preview.count, holes);
            return thin ? (
              <p className="mt-1 text-[10px] text-hazard">{thin}</p>
            ) : null;
          })()
        ) : null}
      </div>

      <div>
        <FieldLabel htmlFor="caddy-vibe">What kind of round</FieldLabel>
        <div className="flex flex-wrap gap-1.5" id="caddy-vibe" role="radiogroup" aria-label="What kind of round">
          {VIBES.map((entry) => (
            <Chip
              key={entry.id}
              role="radio"
              aria-checked={vibe === entry.id}
              active={vibe === entry.id}
              onClick={() => setVibe(entry.id)}
            >
              {entry.label}
            </Chip>
          ))}
        </div>
        <p className="mt-1 font-serif text-[11px] italic text-muted-foreground">
          {meaning}
        </p>
      </div>

      <div>
        <FieldLabel htmlFor="caddy-stretch">How far apart</FieldLabel>
        <div
          className="flex flex-wrap gap-1.5"
          id="caddy-stretch"
          role="radiogroup"
          aria-label="How far apart"
        >
          {STRETCH_CHOICES.map((entry) => (
            <Chip
              key={entry.id}
              role="radio"
              aria-checked={stretch === entry.id}
              active={stretch === entry.id}
              onClick={() => setStretch(entry.id)}
            >
              {entry.label}
            </Chip>
          ))}
        </div>
        <p className="mt-1 font-serif text-[11px] italic text-muted-foreground">
          {stretchNote}
        </p>
      </div>

      <div>
        <FieldLabel htmlFor="caddy-when">When</FieldLabel>
        <div
          className="flex flex-wrap gap-1.5"
          id="caddy-when"
          role="radiogroup"
          aria-label="When the round happens"
        >
          {(["tonight", "tomorrow"] as const).map((choice) => (
            <Chip
              key={choice}
              role="radio"
              aria-checked={when === choice}
              active={when === choice}
              onClick={() => setWhen(choice)}
            >
              {choice === "tonight" ? "Tonight" : "Tomorrow"}
            </Chip>
          ))}
          <span className="mx-0.5 self-center text-[10px] text-muted-foreground">
            tee off
          </span>
          {TEE_OFF_CHOICES.map((choice) => (
            <Chip
              key={choice.minutes}
              active={teeOffMinutes === choice.minutes}
              onClick={() => setTeeOffMinutes(choice.minutes)}
            >
              {choice.label}
            </Chip>
          ))}
        </div>
        <p className="mt-1 font-serif text-[11px] italic text-muted-foreground">
          So nothing on the card is shut when you reach it.
        </p>
      </div>

      <div>
        <FieldLabel htmlFor="caddy-particulars">Particulars</FieldLabel>
        <div className="flex flex-wrap gap-1.5" id="caddy-particulars">
          {PARTICULARS.map((entry) => {
            const on = particulars.includes(entry.id);
            return (
              <Chip
                key={entry.id}
                active={on}
                onClick={() =>
                  setParticulars((current) =>
                    on
                      ? current.filter((id) => id !== entry.id)
                      : [...current, entry.id],
                  )
                }
              >
                {entry.label}
              </Chip>
            );
          })}
        </div>
      </div>

      <div>
        <FieldLabel htmlFor="caddy-note">
          Anything the caddy should know
        </FieldLabel>
        <Input
          id="caddy-note"
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, NOTE_MAX))}
          placeholder="Short walks — one of us is on crutches"
        />
      </div>

      {/* This line quoted the price. It has been kept, without it: what a host
          needs before they press the button is that the caddy is the members'
          part and the rest of the page is not — the number is the refusal's
          business, one tap away, on a sheet with a door in it. */}
      {hasPass ? null : (
        <p className="text-[10px] text-muted-foreground">
          The caddy is the members&apos; part — one round, the whole table.
          Everything else on this page is free, and stays free.
        </p>
      )}

      {freshSheet}
      <DrawWalkSheet
        open={drawOpen}
        onOpenChange={setDrawOpen}
        centre={reach?.centre ?? null}
        pins={reach?.preview?.pins ?? []}
        onUse={(drawn) => {
          setStroke(drawn);
          setDrawOpen(false);
        }}
      />
      {/* The confirmation is entirely about a fee: what a fresh card writes
          over, how long the day has to run, how many goes are left after
          this one. A host without one was being shown all three — "your
          fee's day begins when you tee off" over a fee they had never
          bought, and "this is the last whole card on it" counted off an
          allowance of nothing. Same conflation as the spent panel, one
          screen earlier and without the shelf.

          So with no fee there is nothing to confirm: the ask goes straight
          to the server, which answers it with the green fee. The price
          still arrives with the refusal, which is the covenant's own
          order. (The ask now goes via the open step — same gate, same
          refusal, same sheet.) */}
      <Button
        onClick={() => (hasPass ? setConfirming(true) : openMenu())}
        disabled={pending || !(where.trim() || stroke)}
      >
        <PendingLabel
          pending={pending}
          busy={busy}
          label="Plan the round"
          pendingLabel="Walking the patch"
        />
      </Button>
      {room ? null : (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-11 text-xs font-semibold text-muted-foreground hover:text-fairway"
        >
          Not this round
        </button>
      )}
    </div>
  );
}

/**
 * A paid-up host's badge — the one state of the old fee badge that survives.
 *
 * The other state quoted a price, and that is the whole of what this
 * extraction is for: `Covered` is a fact about the host, which the group may
 * say whenever it likes. A price is an offer, which it may make only in
 * answer to a refusal. Two things wearing one badge is how they came to be
 * confused, so now only one of them has a badge.
 */
function CoveredBadge() {
  return (
    <span className="rounded-md border border-fairway px-1.5 py-0.5 text-[9px] font-bold tracking-[0.14em] text-fairway uppercase">
      Covered
    </span>
  );
}
