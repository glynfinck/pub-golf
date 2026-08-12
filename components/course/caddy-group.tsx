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
  HOLE_CHOICES,
  NOTE_MAX,
  PARTICULARS,
  STRETCH_CHOICES,
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
import { CADDY_CREDITS_SPENT, freshCourseNotice } from "@/lib/caddy/credits";
import {
  decodeEvents,
  thinkingTail,
  type CaddyEvent,
  type CaddyOffer,
} from "@/lib/caddy/stream";
import { centreOf, reachOf, type Reach } from "@/lib/caddy/reach";
import { paceForReach, paceNote, stretchWarning } from "@/lib/caddy/brief";
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
  const [whereTo, setWhereTo] = useState("");
  const [note, setNote] = useState("");
  const [stretch, setStretch] = useState<number>(DEFAULT_STRETCH);

  const meaning = VIBES.find((entry) => entry.id === vibe)?.meaning ?? "";
  // Once a finish is named the pace stops being a choice and becomes a
  // reading: the destination and the hole count decide it between them, and
  // the chips would otherwise sit there claiming otherwise. Nothing is
  // disabled — a host who changes their mind about the pace is really telling
  // us to change the hole count, and seeing both move says so better than a
  // greyed-out control would.
  const derivedPace = reach && whereTo.trim() ? paceForReach(reach.km, holes) : null;
  const stretchNote =
    derivedPace === null
      ? stretchMeaning(stretch)
      : `${paceNote(derivedPace)} Set by finishing in ${whereTo.trim()}.`;

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
    const centre = async (query: string) => {
      if (!query.trim()) return null;
      try {
        const response = await fetch("/api/places/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        const body = (await response.json()) as {
          results?: { lat: number | null; lng: number | null }[];
        };
        return centreOf(body.results ?? []);
      } catch {
        // A ring is an aid, never a gate. A search that will not answer costs
        // the host nothing but the drawing.
        return null;
      }
    };
    const timer = setTimeout(async () => {
      const [from, to] = await Promise.all([centre(where), centre(whereTo)]);
      if (!cancelled) onReach?.(reachOf(from, to, holes));
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [where, whereTo, holes, onReach]);

  /**
   * The first card, over a stream.
   *
   * A route rather than the action, because an action resolves once and the
   * interesting part of a plan is the twenty seconds before it does: the patch
   * lands early enough to frame a map on, and the caddy's own reasoning
   * arrives while it is still reasoning. The tweak below is still an action —
   * it answers in a couple of seconds and there is nothing to narrate.
   *
   * Everything the stream says is optional. A run where every middle event
   * went missing still ends in a card or an honest failure, which is what
   * makes it safe to treat the narration as decoration.
   */
  function plan() {
    run(async () => {
      setThinking("");
      setDoing("");
      refusedRef.current = false;
      const lost = "The caddy lost the ball. Ask again — this one's free.";
      let failure: { error: string; detail?: string } | null = null;
      let landed = false;

      let response: Response;
      try {
        response = await fetch("/api/caddy/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            where,
            whereTo,
            /**
             * The reach, but **only when a finish was actually named.**
             *
             * `reachOf` answers `{ km: 1.2 }` for a single patch — that is the
             * ring's *radius*, not a distance to walk — and `targetKmFor`
             * short-circuits on any `reachKm > 0`, returning `reachKm * 1.15`
             * and never reaching the stretch arm. So every single-patch round
             * was routed at a 1.38km target whatever the host picked, and the
             * spacing chips did nothing at all: at 9 holes on Stretch the
             * honest target is 6km.
             *
             * The same guard already exists ten lines up for the on-screen
             * pace note, which is how the screen could say "steady" while the
             * router ignored it.
             */
            reachKm: whereTo.trim() ? (reach?.km ?? 0) : 0,
            holes,
            vibe,
            particulars,
            note,
            stretch,
            startVenueId: null,
            finishVenueId: null,
          }),
        });
      } catch {
        return { error: lost };
      }

      // A refusal decided before the model was ever asked — no fee, a thin
      // patch, no sign-in — comes back as ordinary JSON rather than as a
      // stream that opens only to apologise.
      if (!response.body || !response.headers.get("content-type")?.includes("ndjson")) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string; offer?: CaddyOffer }
          | null;
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
          onPicked?.(event.ids);
        } else if (event.type === "card") {
          setSessionId(event.sessionId);
          onSession(event.sessionId);
          onTurn?.(event.turnId ?? null);
          await onCourse(event.course, []);
          landed = true;
        } else if (event.offer) {
          refusedRef.current = true;
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
      if (failed) return landed ? failed : await collect(failed.error, failed.detail);
      // A money refusal is a finished run, not a failed one — the sheet says so.
      return landed || refusedRef.current ? {} : await collect(lost);
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
              plan();
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
  if (!open) {
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
  if (allowance && !allowance.canPlan && !sessionId) {
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
      className={cn("engraved flex flex-col gap-3 rounded-xl bg-card px-4 py-3.5", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow text-fairway">Let the caddy plan it</span>
        {/* "Covered" was the whole of what a host could see, and it went on
            saying Covered after the last course had been planned. A pass has
            two dimensions and this badge only ever showed one — so once there
            is a fee, what it says is what is left on it. With no fee it says
            nothing at all: the price belongs to the refusal, not to the form. */}
        {hasPass ? (
          allowance ? <CaddyUsage left={allowance.left} /> : <CoveredBadge />
        ) : null}
      </div>
      <div className="font-serif text-lg leading-tight text-balance">
        Your round, planned in twenty seconds
      </div>
      {moreSheet}
      {feeSheet}

      <div>
        <FieldLabel htmlFor="caddy-where">Where</FieldLabel>
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

      {/* Optional, and quiet about it. Most rounds stay in one patch, so this
          is a second line rather than a second decision — but a crawl is not
          always nine doors off one street, and Finsbury Park to Broadway
          Market is a real round somebody walked. Typing the same place twice
          folds back to one patch in `readBrief`. */}
      <div>
        <FieldLabel htmlFor="caddy-where-to">
          Finishing somewhere else?
        </FieldLabel>
        <Input
          id="caddy-where-to"
          value={whereTo}
          onChange={(event) => setWhereTo(event.target.value.slice(0, WHERE_MAX))}
          placeholder="Optional — Broadway Market"
        />
        <p className="mt-1 text-[10px] text-muted-foreground">
          Leave it empty to stay in one patch.
        </p>
        {/* The same fact the ring shows, in words. It appears only when there
            is something worth saying — a warning on every plan is a warning
            nobody reads — and it appears *before* the fee is spent, which is
            the whole point of doing the arithmetic on the brief screen. */}
        {reach && whereTo.trim() ? (
          <StretchNote km={reach.km} holes={holes} />
        ) : null}
      </div>

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
      <Button
        onClick={() => setConfirming(true)}
        disabled={pending || !where.trim()}
      >
        <PendingLabel
          pending={pending}
          busy={busy}
          label="Plan the round"
          pendingLabel="Walking the patch"
        />
      </Button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="min-h-11 text-xs font-semibold text-muted-foreground hover:text-fairway"
      >
        Not this round
      </button>
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

/**
 * What the destination does to the pace, and the warning if it is a lot.
 *
 * Both lines, because they are the same fact at two volumes. The first always
 * shows once a finish is named — the host has just handed over the number that
 * sets the pace, and watching it change is how they learn the two controls are
 * one control. The second only shows when the walk is long enough to be worth
 * a second thought.
 */
function StretchNote({ km, holes }: { km: number; holes: number }) {
  const warning = stretchWarning(km, holes);
  return (
    <>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Finishing there sets the pace: {paceNote(paceForReach(km, holes)).toLowerCase()}
      </p>
      {warning ? <p className="mt-1 text-[10px] text-hazard">{warning}</p> : null}
    </>
  );
}
