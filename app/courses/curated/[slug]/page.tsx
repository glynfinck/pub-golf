import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CopyCuratedButton } from "@/components/course/copy-curated-button";
import { Masthead } from "@/components/shell/masthead";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { Card } from "@/components/ui/card";
import { HazardPill } from "@/components/ui/chip";
import { HouseMark } from "@/components/ui/house-mark";
import {
  CURATED_COURSES,
  coursePar,
  courseWalkMinutes,
  curatedCourse,
} from "@/lib/course-templates";
import { readHazard } from "@/lib/hazards";

/** Every curated card is fixture — prerender the lot; navigation is free. */
export function generateStaticParams() {
  return CURATED_COURSES.map((course) => ({ slug: course.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const course = curatedCourse(slug);
  return { title: course ? course.name : "Curated courses" };
}

/**
 * A curated card, read-only: the fixture straight off lib/course-templates,
 * no session needed. The one action is copying it into the viewer's own
 * book, which is where the editing happens.
 */
export default async function CuratedCoursePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const course = curatedCourse(slug);
  if (!course) notFound();

  const holes = course.holes;

  return (
    <Screen>
      <Masthead
        back={{ href: "/courses", label: "Courses" }}
        center={<HouseMark className="mx-auto size-6" />}
      />
      <ScreenHeader eyebrow="Curated · the house card" title={course.name} />
      <p className="text-sm text-muted-foreground">{course.blurb}</p>

      <div className="engraved rounded-xl bg-card px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="eyebrow">The card</span>
          <span aria-hidden className="leader flex-1" />
          <span className="tabular font-serif text-xl">par {coursePar(holes)}</span>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {holes.length} pubs · {courseWalkMinutes(holes)} min walking between
          them
        </p>
      </div>

      {holes.map((hole) => {
        const hazard = readHazard(hole.hazard);
        return (
          <div key={hole.number} className="flex flex-col gap-2">
            <Card className="gap-2 px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                <span className="tabular flex size-8 shrink-0 items-center justify-center rounded-full border-[1.5px] border-marker font-serif text-marker">
                  {hole.number}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-serif text-base italic">
                    {hole.venue_name}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {hole.drink}
                  </div>
                </div>
                <span className="tabular shrink-0 font-mono text-sm font-bold">
                  par {hole.par}
                </span>
              </div>

              {hazard ? (
                <div className="flex flex-col gap-1 border-t border-dotted border-border pt-2">
                  <div>
                    <HazardPill>{hazard.label}</HazardPill>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {hole.hazard_note ?? hazard.meaning}
                  </p>
                </div>
              ) : null}

              {hole.penalties.length > 0 ? (
                <div className="flex flex-col gap-1 border-t border-dotted border-border pt-2">
                  {hole.penalties.map((rule) => (
                    <div
                      key={rule.reason}
                      className="flex items-baseline gap-2 text-[11px]"
                    >
                      <span className="tabular shrink-0 font-mono font-bold text-hazard">
                        +{rule.strokes}
                      </span>
                      <span className="text-muted-foreground">
                        {rule.reason}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </Card>

            {hole.walk_minutes_to_next !== null ? (
              <p className="text-center text-[10px] text-muted-foreground">
                ~{hole.walk_minutes_to_next} min walk
              </p>
            ) : null}
          </div>
        );
      })}

      <CopyCuratedButton slug={course.slug} />

      <p className="text-center text-[11px] text-muted-foreground">
        Curated cards are read-only. Copying files one in your book to tweak —
        and every round takes its own snapshot anyway.
      </p>
    </Screen>
  );
}
