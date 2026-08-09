"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Masthead } from "@/components/shell/masthead";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { HoleEditor, type DraftHole } from "@/components/course/hole-editor";
import { PlaceSearch, type FoundPub } from "@/components/course/place-search";
import { Button } from "@/components/ui/button";
import { FieldLabel, Input } from "@/components/ui/input";
import { HouseMark } from "@/components/ui/house-mark";
import { PendingLabel } from "@/components/ui/pending-label";
import { useAction } from "@/hooks/use-action";
import { createCourse } from "@/lib/actions/courses";

/** The course builder: search Google for the pubs, dress each hole with
 * par and drink, save. No map — the Maps app handles directions on the
 * night. */
export default function NewCoursePage() {
  const router = useRouter();
  const { run, pending, busy } = useAction();
  const [name, setName] = useState("");
  const [holes, setHoles] = useState<DraftHole[]>([]);

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
      },
    ]);
  }

  function save() {
    run(async () => {
      const result = await createCourse({
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
        })),
      });
      if (result.error) return result;
      toast.success("Course saved to the book.");
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
        eyebrow={`New course · ${holes.length} holes so far`}
        title="Plot the course"
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

      <PlaceSearch onAdd={addPub} nextHoleNumber={holes.length + 1} />

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
          label={`Save the course · ${holes.length} ${holes.length === 1 ? "hole" : "holes"}`}
          pendingLabel="Filing the course"
        />
      </Button>
    </Screen>
  );
}
