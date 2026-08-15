"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Copy, Map as MapIcon, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Masthead } from "@/components/shell/masthead";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { CaddyGroup } from "@/components/course/caddy-group";
import { CaddyGallery } from "@/components/course/caddy-gallery";
import { useCaddyJob } from "@/hooks/use-caddy-job";
import { JOB_BADGE } from "@/lib/caddy/stages";
import type { Reach } from "@/lib/caddy/reach";
import { echoLine } from "@/lib/caddy/preflight";
import {
  RoutePreview,
  type LivePatch,
} from "@/components/course/route-preview";
import {
  HoleEditor,
  type MoveDirection,
} from "@/components/course/hole-editor";
import { PlaceSearch, type FoundPub } from "@/components/course/place-search";
import { PubMapSheet } from "@/components/course/pub-map-sheet";
import { Button } from "@/components/ui/button";
import { FieldLabel, Input } from "@/components/ui/input";
import { HoldToConfirm } from "@/components/ui/hold-to-confirm";
import { HouseMark } from "@/components/ui/house-mark";
import { ReportBugSheet } from "@/components/support/report-bug-sheet";
import { PendingLabel } from "@/components/ui/pending-label";
import { useAction } from "@/hooks/use-action";
import {
  createCourse,
  deleteCourse,
  duplicateCourse,
  updateCourse,
} from "@/lib/actions/courses";
import {
  appendHole,
  describeDressing,
  draftFromPlan,
  draftHole,
  draftOf,
  insertHole,
  moveHole,
  removeHole,
  replacePub,
  type DraftHole,
} from "@/lib/course-draft";
import type { CaddyAllowance, ResumedCaddy } from "@/lib/data/caddy";
import { CADDY_CREDITS_SPENT, tearOutNotice } from "@/lib/caddy/credits";
import { CaddyMoreSheet } from "@/components/course/caddy-more-sheet";
import { TearOutSheet } from "@/components/course/tear-out-sheet";
import { closeCaddySession, rememberCaddyCourse } from "@/lib/actions/caddy";
import type { PlannedCourse } from "@/lib/caddy/plan";
import { MAPS_BROWSER_KEY } from "@/lib/maps";

/** A saved course back on the drafting table (lib/data/courses loads it). */
export interface CourseBuilderCourse {
  id: string;
  name: string;
  holes: DraftHole[];
}

/**
 * Where the next pub the search finds is going. The field at the top of the
 * page always appends; a seam between two holes inserts at that point, and a
 * hole's own menu sends the search at the pub behind it. The map sheet reads
 * the same target, so opening it mid-pick answers the same question.
 *
 * Aimed at a hole's id rather than its number, because the card can move
 * underneath an open picker — a hole nudged up the order while a seam is
 * open would otherwise leave the search pointed at whatever slid into the
 * position, and a hole taken off would leave it pointed at nothing.
 */
type PickTarget =
  | { mode: "insert"; beforeId: string }
  | { mode: "replace"; id: string };

/**
 * The drafting table, shared by /courses/new and /courses/[id]: search
 * Google for the pubs, dress each hole with par and drink, save. The map
 * sheet shows the patch when the browser has a Maps key; the Maps app
 * still handles directions on the night. Handed a saved course it edits
 * in place, and picks up the copy and tear-out duties too — every change
 * to a course happens at this table.
 *
 * The card is editable in any order, not just downwards: a hole can change
 * its pub without losing its dressing, a pub can go in between two others,
 * and a hole can walk up and down the running order. Nothing here has to be
 * deleted to be changed.
 */
export function CourseBuilder({
  course,
  caddy = false,
  hasPass = false,
  resumed = null,
  reopen = null,
  filedCourseId = null,
  passExpiresAt = null,
  allowance,
}: {
  course?: CourseBuilderCourse;
  /** A caddy conversation this host walked away from, found again by the
   * server. The table opens on the card it had rather than on a blank sheet,
   * and — the part that matters — knows which course it already filed, so the
   * next card writes over that one instead of minting a second. */
  resumed?: ResumedCaddy | null;
  /** A conversation about this course whose patch has been swept, and so needs
   * one trip back to Google before it can be spoken to. The id is all the
   * caddy needs; everything else is already on the session row. */
  reopen?: string | null;
  /**
   * The course this host's live fee has already filed, if any.
   *
   * Separate from `resumed.courseId` because they answer different questions
   * and only one of them survives a second plan. A host who plans twice has
   * two sessions; the newest has filed nothing yet, so resuming it hands back
   * a null course and the next card mints a *second* course on a fee that
   * bought one. This is asked of the fee instead, so it is right whichever
   * session is on top.
   */
  filedCourseId?: string | null;
  /** When the green fee's day runs out, for the confirmation before a fresh
   * card. **Null is the ordinary case**: the day starts at tee-off, so a host
   * planning on Wednesday for Saturday has a fee with no clock on it at all.
   * `freshCourseNotice` says which of those two a host is looking at. */
  passExpiresAt?: string | null;
  /** Whether the host's fee still has a course to give, and where the last one
   * went. The caddy shows one of two faces depending on it. */
  allowance?: CaddyAllowance;
  /** The caddy is on duty: a key, billing on, and a signed-in host. False and
   * the group never renders — the maps-key pattern, so an unconfigured deploy
   * shows the builder exactly as it has always been. */
  caddy?: boolean;
  hasPass?: boolean;
}) {
  const editing = course !== undefined;
  const router = useRouter();
  const { run, pending, busy } = useAction();
  const [name, setName] = useState(course?.name ?? resumed?.course.name ?? "");
  const [holes, setHoles] = useState<DraftHole[]>(
    course?.holes ?? (resumed ? draftFromPlan(resumed.course) : []),
  );
  // The caddy's session, while one is on the table. Saving closes it, which is
  // what drops the dossier — Google's atmosphere facts are read for the length
  // of one conversation and are not ours to keep.
  const [caddySession, setCaddySession] = useState<string | null>(
    resumed?.sessionId ?? null,
  );
  /**
   * The turn that produced what is on the table, when this page watched it
   * arrive.
   *
   * Null on a resumed session, and honestly so: the card was restored from the
   * book rather than handed over, and pointing a report at the session's
   * *latest* turn would be a guess dressed as evidence. The session id is
   * still there and still says which conversation — this only ever narrows it.
   */
  const [caddyTurn, setCaddyTurn] = useState<string | null>(null);

  /**
   * The job, held by the table rather than by the group inside it — the same
   * ownership the Course Room now keeps, and for the same reason: whoever can
   * unmount the group must not be the one whose job it is.
   */
  const caddyJob = useCaddyJob({
    session: caddySession,
    onSession: setCaddySession,
    onTurn: setCaddyTurn,
    onCourse: takeCaddyCourse,
    onPatch: (pins) => setPatch({ pins, picked: [] }),
    onPicked: (ids) =>
      setPatch((current) =>
        current ? { ...current, picked: [...current.picked, ...ids] } : current,
      ),
  });
  // Counts the cards the caddy has handed over, which is all the preview needs
  // to know about to decide whether to walk the route or simply show it.
  const [drawKey, setDrawKey] = useState(0);
  /** How far the round reaches, resolved from the brief's two areas. Held
   * here rather than in the group so the map and the form read one value. */
  const [reach, setReach] = useState<Reach | null>(null);
  /**
   * The patch the caddy is working, while it is still working it.
   *
   * Lives here rather than in the caddy's own group because the map it feeds
   * is up at the top of the page — the point of it is that the neighbourhood
   * is on screen a good few seconds before any hole is, so the card does not
   * arrive into an empty rectangle. Cleared when the card lands, at which
   * point the route takes the same frame over.
   */
  const [patch, setPatch] = useState<LivePatch | null>(null);
  /** The report door, when the caddy planned what is on the table. */
  const [reporting, setReporting] = useState(false);
  // The tear-out sheet, and the caddy's money door behind it. Held here
  // rather than inside either sheet so only one is ever open at a time.
  const [tearing, setTearing] = useState(false);
  const [wantsMore, setWantsMore] = useState(false);
  /**
   * The row a caddy-planned course was filed into the moment it arrived.
   *
   * A course the caddy plans is filed straight away rather than waiting for
   * the host to tap save. The fee bought an evening's legwork, and legwork
   * that lives only in a tab is legwork one closed tab from being bought
   * again — so it belongs to them from the moment it exists, and the day pass
   * running out cannot take it back.
   *
   * It does not put the table into editing mode: `editing` means "opened from
   * the book", and it is what decides whether the caddy is on this page at
   * all. A card that filed itself is still a draft being worked on, with the
   * caddy still sitting beside it.
   */
  // The fee's answer first. `resumed.courseId` is the same fact seen through
  // one session, and it is null exactly when a host has planned twice — which
  // is the case that used to file a duplicate.
  const [savedId, setSavedId] = useState<string | null>(
    filedCourseId ?? resumed?.courseId ?? null,
  );
  const [changed, setChanged] = useState<number[]>([]);
  const [picking, setPicking] = useState<PickTarget | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapQuery, setMapQuery] = useState("");
  // Every edit here renumbers holes further down the page than the thumb
  // that caused it, so the card says out loud what just happened.
  const [announcement, setAnnouncement] = useState("");

  // The chevrons, by hole id: a move that lands on the end of the card
  // disables the button that was just pressed, and focus has to go
  // somewhere better than the top of the document.
  const moveButtons = useRef(
    new Map<string, Partial<Record<MoveDirection, HTMLButtonElement | null>>>(),
  );

  function registerMoveButton(
    id: string,
    direction: MoveDirection,
    node: HTMLButtonElement | null,
  ) {
    const forHole = moveButtons.current.get(id) ?? {};
    forHole[direction] = node;
    moveButtons.current.set(id, forHole);
  }

  /** Puts focus back on the chevron that moved the hole, or its partner
   * when that one has reached the end of the card and gone inert. */
  function restoreMoveFocus(id: string, direction: MoveDirection) {
    requestAnimationFrame(() => {
      const buttons = moveButtons.current.get(id);
      const preferred = buttons?.[direction];
      const fallback = buttons?.[direction === "up" ? "down" : "up"];
      const target =
        preferred && !preferred.disabled
          ? preferred
          : fallback && !fallback.disabled
            ? fallback
            : null;
      target?.focus();
    });
  }

  /**
   * The undo a destructive edit hands back: the card exactly as it was.
   * It restores a whole snapshot, so it is only honest until the next edit
   * — one left on screen through two more changes would quietly throw them
   * away. Every edit below takes it down on its way past.
   */
  const undoToast = useRef<string | number | null>(null);

  function clearUndo() {
    if (undoToast.current !== null) {
      toast.dismiss(undoToast.current);
      undoToast.current = null;
    }
  }

  function undoable(message: string, previous: DraftHole[]) {
    clearUndo();
    undoToast.current = toast(message, {
      onDismiss: () => {
        undoToast.current = null;
      },
      onAutoClose: () => {
        undoToast.current = null;
      },
      action: {
        label: "Undo",
        onClick: () => {
          undoToast.current = null;
          setHoles(previous);
          setAnnouncement("Put back.");
        },
      },
    });
  }

  function addPub(pub: FoundPub) {
    clearUndo();
    setHoles((current) =>
      appendHole(current, draftHole(pub, crypto.randomUUID())),
    );
  }

  /** A pub chosen while a seam or a hole's menu had the search pointed at
   * it. The map is dismissed with the question it was opened to answer.
   * Toasts carry their own live region, so the swap says it once, there. */
  function commitPick(index: number, pub: FoundPub) {
    if (picking?.mode === "insert") {
      clearUndo();
      setHoles((current) =>
        insertHole(current, draftHole(pub, crypto.randomUUID()), index),
      );
      setAnnouncement(`${pub.venue_name} added as hole ${index + 1}.`);
    } else {
      undoable(`Hole ${index + 1} is now ${pub.venue_name}.`, holes);
      setHoles((current) => replacePub(current, index, pub));
    }
    setPicking(null);
    setMapOpen(false);
  }

  /**
   * A card off the caddy, onto the drafting table.
   *
   * It lands as an ordinary draft — every edit the builder offers is live on
   * it, because a caddy-planned course and a hand-plotted one are the same
   * thing once they are on the table. The course name only takes the caddy's
   * suggestion while the host has not written their own.
   */
  async function takeCaddyCourse(planned: PlannedCourse, moved: number[]) {
    clearUndo();
    // A new card is a new walk: the preview redraws itself rather than
    // swapping one route for another between frames. Hand-edits below do not
    // bump this — replaying the animation every time a pub moves would make
    // the map the loudest thing on the page.
    setDrawKey((current) => current + 1);
    const rows = draftFromPlan(planned);
    const named = name.trim() || planned.name;
    // The card is the route now; the patch behind it has done its job.
    setPatch(null);
    setHoles(rows);
    setName(named);
    setChanged(moved);
    setAnnouncement(
      moved.length === 1
        ? `Hole ${moved[0] + 1} is now ${planned.holes[moved[0]]?.venue_name ?? "changed"}.`
        : `The caddy's draft: ${planned.holes.length} holes, par ${planned.holes.reduce((sum, hole) => sum + hole.par, 0)}.`,
    );

    // Filed on arrival, and filed over on every roll and tweak after it, so
    // there is one course in the book rather than one per ask. The state above
    // is already set, so the card is on screen while this happens.
    //
    // Deliberately quiet, and deliberately not fatal. If it fails the host
    // loses nothing they can see — the card is in front of them and the save
    // button still says "Save the course", because `savedId` is what that
    // wording reads and it stays null. Shouting about it would be an error
    // message for a step they never asked for.
    const draft = draftOf(rows, named);
    // Opened from the book: the course already exists and the caddy's change
    // belongs on it. This used to return early instead, from back when the
    // caddy never appeared on a saved course at all — leaving it would mean a
    // tweak that showed on screen and filed nowhere, which is the same missing
    // card the file-on-arrival rule exists to prevent.
    if (editing) {
      await updateCourse(course.id, draft);
      return;
    }
    if (savedId) {
      await updateCourse(savedId, draft);
      return;
    }
    const minted = await createCourse(draft);
    if (!minted.id) return;
    setSavedId(minted.id);
    // And tell the session which course it filed, so a refresh finds it rather
    // than minting a second one. Best-effort: a link that fails to record
    // costs a duplicate at worst, and an error about bookkeeping the host
    // never asked for costs them the card they are looking at.
    if (caddySession) await rememberCaddyCourse(caddySession, minted.id);
  }

  function move(index: number, direction: MoveDirection) {
    const to = direction === "up" ? index - 1 : index + 1;
    if (to < 0 || to >= holes.length) return;
    clearUndo();
    const moved = holes[index];
    setHoles((current) => moveHole(current, index, to));
    setAnnouncement(`${moved.venue_name} is now hole ${to + 1}.`);
    restoreMoveFocus(moved.id, direction);
  }

  function remove(index: number) {
    const gone = holes[index];
    undoable(`${gone.venue_name} is off the card.`, holes);
    setHoles((current) => removeHole(current, index));
  }

  /** The card, in the shape the actions want. Two writers now — the save
   * button and the caddy filing its own card — so it is built in one place. */
  function save() {
    run(async () => {
      const draft = draftOf(holes, name);
      const existing = editing ? course.id : savedId;
      const result = existing
        ? await updateCourse(existing, draft)
        : await createCourse(draft);
      if (result.error) return result;
      // The card is filed, so the conversation is over: stamping the session
      // drops the dossier with it. Best-effort — a course that saved is saved,
      // whatever the tidying does.
      if (caddySession) await closeCaddySession(caddySession);
      toast.success(
        editing || savedId ? "Course refiled." : "Course saved to the book.",
      );
      router.push("/courses");
    });
  }

  function copy() {
    if (!editing) return;
    run(async () => {
      const result = await duplicateCourse(course.id);
      if (result.error || !result.id) return result;
      toast.success("Copy filed beside the original.");
      router.push(`/courses/${result.id}`);
    });
  }

  function tearOut() {
    if (!editing) return;
    run(async () => {
      const result = await deleteCourse(course.id);
      if (result.error) return result;
      toast(`${course.name} torn out of the book.`);
      router.push("/courses");
    });
  }

  // What tearing this out would cost, and which ways on are open. Null for a
  // hand-plotted course, which costs nothing to rebuild.
  const tearNote = allowance
    ? tearOutNotice({
        // The caddy is on this page only when a session for this course was
        // found, which is the same fact — so this needs no extra query.
        caddyPlanned: caddy && editing,
        cardsLeft: allowance.left,
        tweaksLeft: allowance.tweaks,
      })
    : null;

  const par = holes.reduce((sum, hole) => sum + hole.par, 0);
  // In the book by either door: opened from it, or filed there on arrival by
  // the caddy. Only the save button's wording turns on this — `editing` still
  // means "opened from the book", and still decides whether the caddy is here.
  const filed = editing || savedId !== null;

  // Where the open picker is aimed, right now. A target whose hole has since
  // left the card resolves to nothing and the picker quietly closes with it.
  const pickIndex = picking
    ? holes.findIndex(
        (hole) =>
          hole.id ===
          (picking.mode === "insert" ? picking.beforeId : picking.id),
      )
    : -1;
  const pick = pickIndex === -1 ? null : picking;

  // What the map's buttons say depends on what the search is being asked.
  const mapAction =
    pick?.mode === "insert"
      ? {
          label: "Insert",
          aria: (venue: string) => `Insert ${venue} as hole ${pickIndex + 1}`,
        }
      : pick?.mode === "replace"
        ? {
            label: "Choose",
            aria: (venue: string) =>
              `Choose ${venue} for hole ${pickIndex + 1}`,
          }
        : { label: "Add", aria: undefined };

  return (
    <Screen>
      <Masthead
        back={{ href: "/courses", label: "Courses" }}
        center={<HouseMark className="mx-auto size-6" />}
        busy={busy}
      />
      <ScreenHeader
        eyebrow={
          editing
            ? `Edit course · ${holes.length} ${holes.length === 1 ? "hole" : "holes"}`
            : `New course · ${holes.length} holes so far`
        }
        title={editing ? "Retouch the course" : "Plot the course"}
      />

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* The shape of the walk, above everything and always on. A list cannot
          answer "is this a walk or a scatter?" and the map sheet is a tap
          away, so the answer sits here and changes as the card does. Renders
          nothing until there are two pubs with coordinates to draw a leg
          between. */}
      <RoutePreview
        stops={holes}
        // While the caddy plans, its own patch owns the map. Before that, the
        // pre-flight's pins do: the free lean search's results, faint on the
        // ring, so the host sees what the caddy is about to look at before
        // anything is spent.
        live={
          patch ??
          (reach?.preview?.pins.length
            ? { pins: reach.preview.pins, picked: [] }
            : null)
        }
        chip={patch ? null : reach?.preview ? echoLine(reach.preview) : null}
        badge={JOB_BADGE[caddyJob.stage]}
        drawKey={drawKey}
        ring={
          reach
            ? {
                lat: reach.centre.lat,
                lng: reach.centre.lng,
                km: reach.km,
                warn: reach.warn,
              }
            : null
        }
        onOpen={
          MAPS_BROWSER_KEY
            ? () => {
                setPicking(null);
                setMapQuery("");
                setMapOpen(true);
              }
            : undefined
        }
      />

      <div>
        <FieldLabel htmlFor="course-name">Course name</FieldLabel>
        <Input
          id="course-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="The Soho Quick Six"
        />
      </div>

      {/* The caddy **continues** here; it is never offered here.
          Planning has its own room now (app/plan), so the table's job is the
          conversation that already exists: a card handed over from the room,
          or one resumed after a refresh, keeps its ask box and its tweaks.
          With no session there is nothing to continue, and a host who came
          to plot by hand meets a table with no caddy on it at all — which is
          what "plot it by hand" has to mean to be worth choosing.
          Whether the caddy is on duty is still the page's call, not this
          table's: `/courses/[id]` passes `caddy` only when the conversation
          that wrote that course is still open. */}
      {caddy && (caddySession || reopen) ? (
        <CaddyGroup
          job={caddyJob}
          hasPass={hasPass}
          onCourse={takeCaddyCourse}
          reopen={reopen}
          passExpiresAt={passExpiresAt}
          filed={savedId !== null}
          allowance={allowance}
          onReach={setReach}
          reach={reach}
        />
      ) : null}

      {/* The gallery belongs to the table, not to the group inside it, and it
          renders unconditionally: it draws nothing unless the job is open or
          still has something to say, and gating it on the group's own
          condition is how it came to be torn down mid-performance. */}
      <CaddyGallery
        open={caddyJob.open}
        active={caddyJob.active}
        nonce={caddyJob.nonce}
        holes={9}
        stretch={5}
        state={{
          stage: caddyJob.stage,
          menu: caddyJob.menu,
          picked: caddyJob.picked,
          doing: caddyJob.doing,
          thinking: caddyJob.thinking,
          course: caddyJob.course,
          error: caddyJob.error,
        }}
        onDress={(choice) => void caddyJob.dress({ ...choice })}
        onClose={caddyJob.hide}
        onReopen={caddyJob.show}
      />

      <PlaceSearch
        onAdd={addPub}
        nextHoleNumber={holes.length + 1}
        onOpenMap={
          MAPS_BROWSER_KEY
            ? (query) => {
                setPicking(null);
                setMapQuery(query);
                setMapOpen(true);
              }
            : undefined
        }
      />
      {MAPS_BROWSER_KEY ? (
        <PubMapSheet
          open={mapOpen}
          onOpenChange={setMapOpen}
          initialQuery={mapQuery}
          holes={holes}
          onAdd={(pub) => (pick ? commitPick(pickIndex, pub) : addPub(pub))}
          actionLabel={mapAction.label}
          actionAria={mapAction.aria}
        />
      ) : null}

      {holes.map((hole, index) => {
        const openMap = MAPS_BROWSER_KEY
          ? (query: string) => {
              setMapQuery(query);
              setMapOpen(true);
            }
          : undefined;

        return (
          <div key={hole.id} className="flex flex-col gap-4">
            {/* The seam: an insertion point drawn where the pub will land,
                so nobody has to work out where an Add button would drop
                it. Every hole has one in front of it — the field at the
                top of the page is the one that appends. */}
            {pick?.mode === "insert" && pick.beforeId === hole.id ? (
              <PlaceSearch
                mode="pick"
                title={`Adding as hole ${index + 1}`}
                note={`${hole.venue_name} and everything after it move down one.`}
                actionLabel="Insert"
                actionAria={(venue) => `Insert ${venue} as hole ${index + 1}`}
                onAdd={(pub) => commitPick(index, pub)}
                onCancel={() => setPicking(null)}
                nextHoleNumber={index + 1}
                onOpenMap={openMap}
              />
            ) : (
              <button
                type="button"
                aria-label={`Insert a pub before hole ${index + 1}`}
                onClick={() =>
                  setPicking({ mode: "insert", beforeId: hole.id })
                }
                className="flex min-h-10 items-center gap-2 text-muted-foreground hover:text-fairway focus-visible:text-fairway"
              >
                <span
                  className="flex-1 border-t border-dotted border-current opacity-40"
                  aria-hidden
                />
                <span className="flex size-6 items-center justify-center rounded-full border-[1.5px] border-dashed border-current">
                  <Plus size={12} aria-hidden />
                </span>
                <span className="eyebrow text-current">Insert here</span>
                <span
                  className="flex-1 border-t border-dotted border-current opacity-40"
                  aria-hidden
                />
              </button>
            )}

            {pick?.mode === "replace" && pick.id === hole.id ? (
              <PlaceSearch
                mode="pick"
                title={`Hole ${index + 1} · pick the pub`}
                note={`${hole.venue_name} comes off; ${describeDressing(hole)} stays.`}
                actionLabel="Choose"
                actionAria={(venue) => `Choose ${venue} for hole ${index + 1}`}
                onAdd={(pub) => commitPick(index, pub)}
                onCancel={() => setPicking(null)}
                nextHoleNumber={index + 1}
                onOpenMap={openMap}
              />
            ) : (
              <HoleEditor
                hole={hole}
                number={index + 1}
                total={holes.length}
                // The caddy answered an ask: the hole that moved says so for a
                // beat, and every other hole holds still. Stillness is the
                // message — the caddy kept your card.
                className={
                  changed.includes(index)
                    ? "rounded-xl ring-2 ring-marker/60"
                    : undefined
                }
                onChange={(patch) => {
                  clearUndo();
                  setChanged([]);
                  setHoles((current) =>
                    current.map((h, i) =>
                      i === index ? { ...h, ...patch } : h,
                    ),
                  );
                }}
                onRemove={() => remove(index)}
                onMove={(direction) => move(index, direction)}
                onReplace={() => setPicking({ mode: "replace", id: hole.id })}
                registerMoveButton={(direction, node) =>
                  registerMoveButton(hole.id, direction, node)
                }
              />
            )}
          </div>
        );
      })}

      {holes.length > 0 ? (
        <div className="flex flex-col items-center gap-2">
          <p className="text-center text-[11px] text-muted-foreground">
            Par {par} · walking times measured between pubs automatically.
          </p>
          {/* The map has always drawn the course — numbered pins in playing
              order, joined by the walk. It was only ever reachable from the
              search field, so the card now says so out loud once there is a
              route worth looking at. Free, like the rest of the table. */}
          {MAPS_BROWSER_KEY && holes.length > 1 ? (
            <button
              type="button"
              onClick={() => {
                setPicking(null);
                setMapQuery("");
                setMapOpen(true);
              }}
              className="flex min-h-11 items-center gap-1.5 text-xs font-semibold text-fairway"
            >
              <MapIcon size={14} aria-hidden /> See the course on the map
            </button>
          ) : null}
        </div>
      ) : null}

      {/* A caddy-planned course files itself the moment it lands, so it is
          already the host's and a closed tab loses nothing. Said only where it
          is true: a course opened *from* the book does not need telling it is
          in there, and neither of them auto-saves the hand edits made after —
          which is why this says what it says rather than "saved when you
          leave", the first wording and a promise the table does not keep. */}
      {savedId ? (
        <p className="text-center text-[11px] text-muted-foreground">
          Already in your book. Changes here go in when you save.
        </p>
      ) : null}

      <Button
        onClick={save}
        disabled={pending || !name.trim() || holes.length === 0}
        className={filed ? undefined : "mt-auto"}
      >
        <PendingLabel
          pending={pending}
          busy={busy}
          label={
            filed
              ? `Save changes · ${holes.length} ${holes.length === 1 ? "hole" : "holes"}`
              : `Save the course · ${holes.length} ${holes.length === 1 ? "hole" : "holes"}`
          }
          pendingLabel={filed ? "Refiling the course" : "Filing the course"}
        />
      </Button>

      {/* The report door, and only where there is a conversation to point at.
          A complaint about a hand-plotted course is a complaint about the
          player's own typing; a complaint about a caddy course can be answered,
          because the session behind it holds the brief, the card and the trace
          of what the caddy actually did. That is the whole feedback loop, and
          it is why this sits here rather than only on Profile. */}
      {caddySession ? (
        <div className="border-t border-dotted border-border pt-4">
          <button
            type="button"
            onClick={() => setReporting(true)}
            aria-haspopup="dialog"
            data-testid="report-course-open"
            className="min-h-11 w-full text-center text-xs font-bold text-fairway"
          >
            Something wrong with this course?
          </button>
          <ReportBugSheet
            open={reporting}
            onOpenChange={setReporting}
            caddySessionId={caddySession}
            caddyTurnId={caddyTurn}
            area="courses"
          />
        </div>
      ) : null}

      {editing ? (
        <div className="flex flex-col gap-2 border-t border-dotted border-border pt-4">
          <Button variant="outline" onClick={copy} disabled={pending}>
            <Copy aria-hidden /> File a copy beside it
          </Button>
          {/* A caddy-planned course is torn out through a sheet, because a
              fee files one course and this is the button that spends it — the
              count, and the ways on, belong beside the decision rather than in
              a line of small print above it. A hand-plotted one costs nothing
              to rebuild and keeps the plain hold it always had. */}
          {tearNote ? (
            <>
              <Button
                variant="outline"
                onClick={() => setTearing(true)}
                disabled={pending}
                className="text-hazard"
              >
                <Trash2 aria-hidden /> Tear out of the book
              </Button>
              <TearOutSheet
                open={tearing}
                onOpenChange={setTearing}
                notice={tearNote}
                courseName={name.trim() || course?.name || "This course"}
                pending={pending}
                onConfirm={tearOut}
                onMore={() => {
                  // One sheet at a time: this closes as the caddy's own door
                  // opens, the way the round's rules sheet hands over to the
                  // report sheet.
                  setTearing(false);
                  setWantsMore(true);
                }}
              />
              <CaddyMoreSheet
                open={wantsMore}
                onOpenChange={setWantsMore}
                courseId={allowance?.courseId}
                standing={CADDY_CREDITS_SPENT}
              />
            </>
          ) : (
            <HoldToConfirm
              label="Hold to tear out of the book"
              holdingLabel="Keep holding — tearing it out"
              disabled={pending}
              onConfirm={tearOut}
            />
          )}
          <p className="text-center text-[11px] text-muted-foreground">
            The copy is the course as last saved. Tearing it out never touches a
            round already played on it.
          </p>
        </div>
      ) : null}
    </Screen>
  );
}
