"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Masthead } from "@/components/shell/masthead";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { HoleEditor, type DraftHole } from "@/components/course/hole-editor";
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
import { MAPS_BROWSER_KEY } from "@/lib/maps";

/** A saved course back on the drafting table (lib/data/courses loads it). */
export interface CourseBuilderCourse {
  id: string;
  name: string;
  holes: DraftHole[];
}

/**
 * The drafting table, shared by /courses/new and /courses/[id]: search
 * Google for the pubs, dress each hole with par and drink, save. The map
 * sheet shows the patch when the browser has a Maps key; the Maps app
 * still handles directions on the night. Handed a saved course it edits
 * in place, and picks up the copy and tear-out duties too — every change
 * to a course happens at this table.
 */
export function CourseBuilder({ course }: { course?: CourseBuilderCourse }) {
  const editing = course !== undefined;
  const router = useRouter();
  const { run, pending, busy } = useAction();
  const [name, setName] = useState(course?.name ?? "");
  const [holes, setHoles] = useState<DraftHole[]>(course?.holes ?? []);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapQuery, setMapQuery] = useState("");

  function addPub(pub: FoundPub) {
    setHoles((current) => [
      ...current,
      {
        ...pub,
        drink: "Pint of your choosing",
        par: 4,
        hazard: null,
        hazard_note: null,
        penalties: [],
        walk_minutes_to_next: null,
      },
    ]);
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

      <div>
        <FieldLabel htmlFor="course-name">Course name</FieldLabel>
        <Input
          id="course-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="The Soho Quick Six"
        />
      </div>

      <PlaceSearch
        onAdd={addPub}
        nextHoleNumber={holes.length + 1}
        onOpenMap={
          MAPS_BROWSER_KEY
            ? (query) => {
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
          onAdd={addPub}
        />
      ) : null}

      {holes.map((hole, index) => (
        <HoleEditor
          key={`${hole.venue_name}-${index}`}
          hole={hole}
          number={index + 1}
          onChange={(patch) =>
            setHoles((current) =>
              current.map((h, i) => (i === index ? { ...h, ...patch } : h)),
            )
          }
          onRemove={() =>
            setHoles((current) => current.filter((_, i) => i !== index))
          }
        />
      ))}

      {holes.length > 0 ? (
        <p className="text-center text-[11px] text-muted-foreground">
          Par {par} · walking times measured between pubs automatically.
        </p>
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
