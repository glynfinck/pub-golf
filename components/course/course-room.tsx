"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { APIProvider } from "@vis.gl/react-google-maps";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { BriefForm } from "@/components/course/brief-form";
import { CaddyGallery } from "@/components/course/caddy-gallery";
import { useCaddyJob } from "@/hooks/use-caddy-job";
import {
  DrawSurface,
  type DrawControls,
} from "@/components/course/draw-walk-sheet";
import { StageBar } from "@/components/course/stage-bar";
import { createCourse } from "@/lib/actions/courses";
import { rememberCaddyCourse } from "@/lib/actions/caddy";
import { draftFromPlan, draftOf } from "@/lib/course-draft";
import { stageBack, undoFor, type PlanStage } from "@/lib/caddy/stages";
import { RetractingPanel } from "@/components/course/retracting-panel";
import { MAPS_BROWSER_KEY } from "@/lib/maps";
import { strokeLengthKm, type StrokePoint } from "@/lib/caddy/stroke";
import type { CaddyAllowance } from "@/lib/data/caddy";
import type { Reach } from "@/lib/caddy/reach";
import type { PlannedCourse } from "@/lib/caddy/plan";

/**
 * The Course Room: the caddy's own place, and the map is the floor of it.
 *
 * The caddy grew up inside the drafting table's form — a map-shaped product
 * bolted above a list-shaped one, sharing one scrolling column so neither
 * read clearly. This is the room it should always have had: the map fills
 * the screen, the brief lives in a panel beneath it that never goes away,
 * and the plan performs on the same ground the host aimed it at.
 *
 * **The map is the draw surface.** Not a picture with a pen button on it —
 * the pen *is* the screen. Reposition, hold still, draw: the primary way to
 * aim the caddy, with the density field showing where a night can actually
 * live before a stroke is committed. The typed patch is still there, in the
 * panel, for the host who would rather name a place.
 *
 * **The job is the group's, not the room's.** Everything about planning —
 * the fee gate, the open step, the menu, the stream, the gallery and the
 * pill — belongs to `CaddyGroup`, which stands here in `room` mode wearing
 * different furniture. One implementation of the job; two rooms to stand it
 * in. Nothing about the drafting table changes, and it stays free.
 */
export function CourseRoom({
  hasPass,
  allowance,
  passExpiresAt = null,
  session: sessionProp = null,
  filed = false,
}: {
  hasPass: boolean;
  allowance?: CaddyAllowance;
  passExpiresAt?: string | null;
  session?: string | null;
  filed?: boolean;
}) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [stroke, setStroke] = useState<StrokePoint[] | null>(null);
  const [reach, setReach] = useState<Reach | null>(null);
  /** The card, once one lands. The room does not edit it — the drafting
   * table owns editing, as it owns every course — so this is a door rather
   * than a form. */
  const [landed, setLanded] = useState<PlannedCourse | null>(null);
  /** The conversation behind the card, so the ask box has something to spend
   * and the drafting table can be handed the right thread. */
  const [session, setSession] = useState<string | null>(sessionProp);
  /** The patch as Places answered it — the map behind the gallery should be
   * on the ground the plan is actually about. */
  const [pins, setPins] = useState<{ id: string; lat: number; lng: number }[]>(
    [],
  );
  /** The course row, once the card is in the book. What turns "Open on the
   * drafting table" from a hand-off of an unsaved draft into a door onto a
   * saved course. */
  const [filedId, setFiledId] = useState<string | null>(null);
  /** Whether the panel is up. Down to begin with: the room's first move is
   * aiming the map, and the brief is a tab away. All-or-nothing retraction
   * and the tab itself belong to `RetractingPanel`, which the gallery wears
   * too — one panel behaviour under both maps. */
  const [panelOpen, setPanelOpen] = useState(false);
  /** Whether the map is held still — reported by the surface's own handlers,
   * so the rail and the pen can never disagree about which act is on. */
  const [locked, setLocked] = useState(false);
  /**
   * Whether a request is in flight. The rail closes the road back only for
   * this — never for a stage *label*, which stays non-null at the menu and
   * after a failure and would leave the rail dead in both.
   */
  const draw = useRef<DrawControls | null>(null);

  /**
   * The job, held by the room rather than by the group inside it.
   *
   * This is the fix six reviews asked for. The gallery is a portal the job
   * renders, and the room used to swap `CaddyGroup` out for a card panel the
   * moment a plan landed — unmounting the portal mid-performance and taking
   * the session, the menu and the brief with it. A job the room holds cannot
   * be destroyed by the room re-rendering, so the finale plays.
   */
  const job = useCaddyJob({
    session,
    onSession: setSession,
    onCourse: (course) => {
      setLanded(course);
      setPanelOpen(true);
      void file(course);
    },
    onPatch: setPins,
  });

  /**
   * File the card the moment it lands.
   *
   * **The room never wrote anything down.** Filing lived only in the drafting
   * table's `takeCaddyCourse`, and the server side only ever *links* a course
   * it was told about — so a plan made here existed as `caddy_turns.result`
   * and nowhere else. Close the tab, press "Stay here", or let the twelve-hour
   * dossier window lapse, and a paid evening was unreachable. It also made
   * `feeFiledCourse()` answer null, so the next plan took another credit while
   * telling the host there was nothing to write over.
   *
   * Quiet and non-fatal, exactly as the table does it: the card is on screen
   * either way, and an error about bookkeeping the host never asked for costs
   * them the thing they are looking at.
   */
  async function file(course: PlannedCourse) {
    try {
      const minted = await createCourse(
        draftOf(draftFromPlan(course), course.name),
      );
      if (!minted.id) return;
      setFiledId(minted.id);
      const thread = job.sessionId ?? session;
      if (thread) await rememberCaddyCourse(thread, minted.id);
    } catch {
      // Best effort. `filedId` stays null, which is what every other reader
      // of it already treats as "not written down yet".
    }
  }

  const progress = {
    locked,
    aimed: Boolean(stroke),
    planning: job.working,
    carded: landed != null,
  };

  /**
   * Stepping back an act, undoing exactly what that act owns and no more.
   *
   * The rule is in `undoFor`, not here: back to Draw keeps the frame the host
   * lined up, back to Tune keeps the line they drew, and only Area drops both.
   * Getting that wrong is how a "back" button becomes a thing nobody presses.
   */
  function goToStage(stage: PlanStage) {
    const undo = undoFor(stage);
    if (undo.release) {
      draw.current?.release();
      setLocked(false);
    } else if (undo.clearStroke) {
      draw.current?.redraw();
    }
    if (undo.clearStroke) setStroke(null);
    if (stage === "tune") setPanelOpen(true);
    if (stage === "area" || stage === "draw") setPanelOpen(false);
    if (stage !== "enrich") {
      setLanded(null);
      // Stepping back behind the caddy ends its run rather than orphaning it:
      // a live menu left behind the host is a pill that dresses a stale
      // session when they eventually tap it.
      job.abandon();
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-background">
      {/* One bar, and the gallery wears the same one. Back steps an act at a
          time and only leaves the room from the first act — the arrow that
          used to be the way out is now the way *back*, which is the thing a
          host in the middle of four acts actually wants from it. */}
      <StageBar
        progress={progress}
        job={job.stage}
        holes={landed?.holes.length ?? null}
        onBack={() => {
          const back = stageBack(progress);
          if (back) goToStage(back);
          else router.back();
        }}
      />

      {/* The floor: the draw surface, edge to edge. Without a browser key
          there is no map and no apology — the panel's own fields still plan
          a round, exactly as they always have.

          **Flex column, and it has to be.** `DrawSurface` sizes itself as a
          flex *child* (`flex-1`), which is how it fills the sheet it was
          written for. Handed a plain block parent it has no height at all,
          the `size-full` map inside it resolves to zero pixels, and the room
          renders a map nobody can see — which is exactly what it did. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {MAPS_BROWSER_KEY ? (
          <APIProvider apiKey={MAPS_BROWSER_KEY}>
            <DrawSurface
              ref={draw}
              centre={reach?.centre ?? null}
              pins={pins.length ? pins : (reach?.preview?.pins ?? [])}
              dark={resolvedTheme === "dark"}
              onLockChange={setLocked}
              onUse={(drawn) => {
                setStroke(drawn);
                // The line is drawn, so the next question is the brief's —
                // open it rather than making the host find the tab.
                setPanelOpen(true);
              }}
              useLabel="Take this walk to the brief"
            />
          </APIProvider>
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center text-xs text-muted-foreground">
            No map on this deploy — name a patch below and the caddy plans it
            exactly as it always has.
          </div>
        )}
      </div>

      {/* The panel: retractable, scrollable, and never dismissed. The brief
          lives here through every stage, so there is nothing to close and no
          state to lose — the panel *is* the room's furniture.

          A landed card retracts on the same tab as the brief did, and that
          matters more than it looks: the card is the moment the host most
          wants the map back, to see what they have been handed walked out on
          the ground they aimed at. It used to be the one state the panel
          could not be pushed down from. */}
      <RetractingPanel
        open={panelOpen}
        onToggle={() => setPanelOpen((open) => !open)}
        label={
          landed
            ? `The card · ${landed.holes.length} holes`
            : stroke
              ? "The brief · walk drawn"
              : "The brief"
        }
      >
        {landed ? (
          <div className="flex flex-col gap-2.5 px-4 pt-1 pb-4">
            <span className="eyebrow text-fairway">On the table</span>
            <div className="font-serif text-lg leading-tight">
              {landed.name}
            </div>
            <p className="text-xs text-muted-foreground">
              {landed.holes.length} holes, walked in order. Every edit lives on
              the drafting table — drinks, pars, hazards, the lot.
            </p>
            {/* `?caddy=1` is the hand-over: it is what tells the table to
                reopen this conversation, so the card arrives with its ask
                box. Without it the table is blank by design. */}
            {/* A saved course opens at its own address; only an unfiled
                one has to go through the blank table with `?caddy=1`. */}
            <Button
              onClick={() =>
                router.push(
                  filedId ? `/courses/${filedId}` : "/courses/new?caddy=1",
                )
              }
            >
              Open on the drafting table
            </Button>
            <button
              type="button"
              onClick={() => setLanded(null)}
              className="min-h-11 text-xs font-semibold text-muted-foreground hover:text-fairway"
            >
              Stay here
            </button>
          </div>
        ) : null}
        {/* **A sibling, never a replacement.** The card block above used to
            stand in place of this group, which unmounted the job holding the
            gallery. Hidden rather than removed while a card is up: the brief
            keeps its fields, the job keeps its session, and "Stay here" comes
            back to the round the host was building rather than to a blank. */}
        <div className={landed ? "hidden" : undefined}>
          {stroke ? (
            <p className="px-4 pt-2 text-[11px] font-semibold text-fairway">
              Walk drawn — {strokeLengthKm(stroke).toFixed(1)} km. The caddy
              will look along it.
            </p>
          ) : null}
          <BriefForm
            job={job}
            stroke={stroke}
            hasPass={hasPass}
            allowance={allowance}
            passExpiresAt={passExpiresAt}
            filed={filed}
            onReach={setReach}
          />
        </div>
      </RetractingPanel>

      {/* The gallery is the room's, not the group's — so nothing the room
          renders can tear it down. */}
      <CaddyGallery
        open={job.open}
        active={job.active}
        nonce={job.nonce}
        holes={9}
        stretch={5}
        state={{
          stage: job.stage,
          menu: job.menu,
          picked: job.picked,
          doing: job.doing,
          thinking: job.thinking,
          course: job.course,
          error: job.error,
        }}
        onDress={(choice) => void job.dress({ ...choice })}
        onClose={job.hide}
        onReopen={job.show}
        onStep={goToStage}
        progress={progress}
      />
    </div>
  );
}
