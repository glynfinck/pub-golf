"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Copy, Map as MapIcon, Plus } from "lucide-react";
import { toast } from "sonner";
import { Masthead } from "@/components/shell/masthead";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { CaddyGroup } from "@/components/course/caddy-group";
import { HoleEditor, type MoveDirection } from "@/components/course/hole-editor";
import { PlaceSearch, type FoundPub } from "@/components/course/place-search";
import { PubMapSheet } from "@/components/course/pub-map-sheet";
import { Button } from "@/components/ui/button";
import { FieldLabel, Input } from "@/components/ui/input";
import { HoldToConfirm } from "@/components/ui/hold-to-confirm";
import { HouseMark } from "@/components/ui/house-mark";
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
  draftHole,
  insertHole,
  moveHole,
  removeHole,
  replacePub,
  type DraftHole,
} from "@/lib/course-draft";
import { closeCaddySession } from "@/lib/actions/caddy";
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
}: {
  course?: CourseBuilderCourse;
  /** The caddy is on duty: a key, billing on, and a signed-in host. False and
   * the group never renders — the maps-key pattern, so an unconfigured deploy
   * shows the builder exactly as it has always been. */
  caddy?: boolean;
  hasPass?: boolean;
}) {
  const editing = course !== undefined;
  const router = useRouter();
  const { run, pending, busy } = useAction();
  const [name, setName] = useState(course?.name ?? "");
  const [holes, setHoles] = useState<DraftHole[]>(course?.holes ?? []);
  // The caddy's session, while one is on the table. Saving closes it, which is
  // what drops the dossier — Google's atmosphere facts are read for the length
  // of one conversation and are not ours to keep.
  const [caddySession, setCaddySession] = useState<string | null>(null);
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
  function takeCaddyCourse(planned: PlannedCourse, moved: number[]) {
    clearUndo();
    setHoles(
      planned.holes.map((hole) => ({
        id: crypto.randomUUID(),
        venue_id: hole.venue_id,
        venue_name: hole.venue_name,
        address: hole.address,
        rating: hole.rating,
        lat: hole.lat,
        lng: hole.lng,
        drink: hole.drink,
        par: hole.par,
        hazard: hole.hazard,
        hazard_note: hole.hazard_note,
        penalties: hole.penalties,
        walk_minutes_to_next: null,
      })),
    );
    setName((current) => current.trim() || planned.name);
    setChanged(moved);
    setAnnouncement(
      moved.length === 1
        ? `Hole ${moved[0] + 1} is now ${planned.holes[moved[0]]?.venue_name ?? "changed"}.`
        : `The caddy's draft: ${planned.holes.length} holes, par ${planned.holes.reduce((sum, hole) => sum + hole.par, 0)}.`,
    );
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

  function save() {
    run(async () => {
      const draft = {
        name,
        holes: holes.map((hole) => ({
          venue_id: hole.venue_id,
          venue_name: hole.venue_name,
          drink: hole.drink,
          par: hole.par,
          hazard: hole.hazard,
          hazard_note: hole.hazard_note,
          // A rule with no offence on it is a half-typed thought, not a rule.
          penalties: hole.penalties.filter((rule) => rule.reason.trim() !== ""),
          lat: hole.lat,
          lng: hole.lng,
          walk_minutes_to_next: hole.walk_minutes_to_next,
        })),
      };
      const result = editing
        ? await updateCourse(course.id, draft)
        : await createCourse(draft);
      if (result.error) return result;
      // The card is filed, so the conversation is over: stamping the session
      // drops the dossier with it. Best-effort — a course that saved is saved,
      // whatever the tidying does.
      if (caddySession) await closeCaddySession(caddySession);
      toast.success(editing ? "Course refiled." : "Course saved to the book.");
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

  const par = holes.reduce((sum, hole) => sum + hole.par, 0);

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
            aria: (venue: string) => `Choose ${venue} for hole ${pickIndex + 1}`,
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

      <div>
        <FieldLabel htmlFor="course-name">Course name</FieldLabel>
        <Input
          id="course-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="The Soho Quick Six"
        />
      </div>

      {/* The caddy: one group above the free search, and nothing at all when
          it is off duty. Everything below it is the builder as it has always
          been — the fee buys the planning, never the table. */}
      {caddy && !editing ? (
        <CaddyGroup
          hasPass={hasPass}
          onCourse={takeCaddyCourse}
          onSession={setCaddySession}
        />
      ) : null}

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
                onClick={() => setPicking({ mode: "insert", beforeId: hole.id })}
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
                    current.map((h, i) => (i === index ? { ...h, ...patch } : h)),
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

      <Button
        onClick={save}
        disabled={pending || !name.trim() || holes.length === 0}
        className="mt-auto"
      >
        <PendingLabel
          pending={pending}
          busy={busy}
          label={
            editing
              ? `Save changes · ${holes.length} ${holes.length === 1 ? "hole" : "holes"}`
              : `Save the course · ${holes.length} ${holes.length === 1 ? "hole" : "holes"}`
          }
          pendingLabel={editing ? "Refiling the course" : "Filing the course"}
        />
      </Button>

      {editing ? (
        <div className="flex flex-col gap-2 border-t border-dotted border-border pt-4">
          <Button variant="outline" onClick={copy} disabled={pending}>
            <Copy aria-hidden /> File a copy beside it
          </Button>
          <HoldToConfirm
            label="Hold to tear out of the book"
            holdingLabel="Keep holding — tearing it out"
            disabled={pending}
            onConfirm={tearOut}
          />
          <p className="text-center text-[11px] text-muted-foreground">
            The copy is the course as last saved. Tearing it out never touches
            a round already played on it.
          </p>
        </div>
      ) : null}
    </Screen>
  );
}
