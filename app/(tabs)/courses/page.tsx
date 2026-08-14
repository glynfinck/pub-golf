import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CoursesList } from "@/components/course/courses-list";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RuleDouble } from "@/components/ui/rule";
import { CURATED_COURSES, coursePar } from "@/lib/course-templates";
import { getMyCourses } from "@/lib/data/courses";
import { cn } from "@/lib/utils";

export const metadata = { title: "The course book" };

const courseRow =
  "flex min-h-13 items-center gap-2 hover:bg-secondary/40 -mx-4 px-4";

export default async function CoursesPage() {
  const courses = await getMyCourses();

  return (
    <Screen withTabBar>
      <RuleDouble head />
      <ScreenHeader eyebrow="The course book" title="Your courses" />

      {/* "Nothing of your own in the book" has to mean the live ones — a host
          whose only course is put away is not starting from scratch, and
          telling them so would hide the drawer that has it. */}
      {courses.length > 0 ? (
        <CoursesList courses={courses} />
      ) : (
        <Card className="gap-0 px-4 text-sm text-muted-foreground">
          Nothing of your own in the book yet. Plot a course — or copy a
          curated card below and tweak it.
        </Card>
      )}

      {/* One tap, then the choice. Which room you plan in is a decision
          worth a screen of its own (app/courses/start) — offering both here
          made the paid one read as a variant of the free one. */}
      <Link href="/courses/start" className={cn(buttonVariants(), "w-full")}>
        Plot a new course
      </Link>

      <section>
        <h3 className="eyebrow mb-2">Curated · the house cards</h3>
        <Card className="gap-0 px-4 py-1">
          {CURATED_COURSES.map((course, index) => (
            <Link
              key={course.slug}
              href={`/courses/curated/${course.slug}`}
              className={cn(courseRow, index > 0 && "border-t border-border")}
            >
              <span className="tabular flex size-8 shrink-0 items-center justify-center rounded-full border-[1.5px] border-fairway font-serif text-sm text-fairway">
                {course.holes.length}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm">{course.name}</b>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {course.holes.length} holes · par {coursePar(course.holes)} ·
                  read-only until copied
                </span>
              </span>
              <ChevronRight
                size={16}
                aria-hidden
                className="shrink-0 text-muted-foreground"
              />
            </Link>
          ))}
        </Card>
      </section>

      <p className="text-center text-[11px] text-muted-foreground">
        Courses are reusable — every round takes its own snapshot. Tap a
        course to retouch it; the menu beside it files copies and tears out.
        Pubs come from Google; you bring the par and the drinks.
      </p>
    </Screen>
  );
}
